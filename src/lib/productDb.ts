import { createClient } from '@supabase/supabase-js';

// Product database (Trade Show Portal Supabase)
const productSupabaseUrl = process.env.NEXT_PUBLIC_PRODUCT_SUPABASE_URL!;
const productSupabaseAnonKey = process.env.NEXT_PUBLIC_PRODUCT_SUPABASE_ANON_KEY!;

export const productDb = createClient(productSupabaseUrl, productSupabaseAnonKey);
