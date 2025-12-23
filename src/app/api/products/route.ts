import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Product database (Trade Show Portal Supabase)
const productSupabaseUrl = process.env.NEXT_PUBLIC_PRODUCT_SUPABASE_URL!;
const productSupabaseAnonKey = process.env.NEXT_PUBLIC_PRODUCT_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    
    if (!query || query.length < 2) {
      return NextResponse.json({ products: [] });
    }

    const productDb = createClient(productSupabaseUrl, productSupabaseAnonKey);

    // Search products by style number or description
    const { data: products, error } = await productDb
      .from('products')
      .select('product_id, style_number, description, category, price')
      .or(`style_number.ilike.%${query}%,description.ilike.%${query}%`)
      .order('style_number', { ascending: true })
      .limit(10);

    if (error) {
      console.error('Product search error:', error);
      return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
    }

    // Fetch first image for each product
    if (products && products.length > 0) {
      const productIds = products.map(p => p.product_id);
      
      const { data: images } = await productDb
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', productIds)
        .eq('sort_order', 0);

      const imageMap: Record<string, string> = {};
      images?.forEach(img => {
        imageMap[img.product_id] = img.image_url;
      });

      const productsWithImages = products.map(p => ({
        ...p,
        image_url: imageMap[p.product_id] || null,
      }));

      return NextResponse.json({ products: productsWithImages });
    }

    return NextResponse.json({ products: products || [] });
  } catch (err) {
    console.error('Product search error:', err);
    return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
  }
}
