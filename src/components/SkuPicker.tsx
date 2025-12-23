'use client';

import { useState, useEffect, useRef } from 'react';

interface Product {
  product_id: string;
  style_number: string;
  description: string | null;
  category: string | null;
  price: number | null;
  image_url: string | null;
}

interface SkuPickerProps {
  searchQuery: string;
  onSelect: (product: Product) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export default function SkuPicker({ searchQuery, onSelect, onClose, position }: SkuPickerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchProducts(searchQuery);
    } else {
      setProducts([]);
    }
  }, [searchQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [products]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, products.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && products.length > 0) {
        e.preventDefault();
        onSelect(products[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [products, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  async function searchProducts(query: string) {
    setLoading(true);
    try {
      const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setProducts(data.products || []);
    } catch (err) {
      console.error('Product search error:', err);
      setProducts([]);
    }
    setLoading(false);
  }

  // Get the base URL for product catalog
  const productCatalogUrl = process.env.NEXT_PUBLIC_PRODUCT_CATALOG_URL || 'http://localhost:3002';

  return (
    <div
      ref={containerRef}
      className="absolute z-50 bg-white border border-analog-border rounded-lg shadow-xl overflow-hidden"
      style={{
        top: position.top,
        left: position.left,
        width: '360px',
        maxHeight: '320px',
      }}
    >
      <div className="px-3 py-2 bg-analog-surface-alt border-b border-analog-border">
        <p className="text-xs text-analog-text-muted">
          Search products by SKU or description
        </p>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
        {loading ? (
          <div className="px-4 py-6 text-center text-analog-text-muted">
            <div className="inline-block w-5 h-5 border-2 border-analog-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="px-4 py-6 text-center text-analog-text-muted text-sm">
            {searchQuery.length < 2 ? 'Type at least 2 characters...' : 'No products found'}
          </div>
        ) : (
          products.map((product, index) => (
            <button
              key={product.product_id}
              onClick={() => onSelect(product)}
              className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-analog-accent/10'
                  : 'hover:bg-analog-surface-alt'
              }`}
            >
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.style_number}
                  className="w-10 h-10 object-cover rounded"
                />
              ) : (
                <div className="w-10 h-10 bg-analog-border rounded flex items-center justify-center">
                  <svg className="w-5 h-5 text-analog-text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-analog-text truncate">
                  {product.style_number}
                </p>
                <p className="text-xs text-analog-text-muted truncate">
                  {product.description || product.category || 'No description'}
                </p>
              </div>
              {product.price && (
                <span className="text-sm text-analog-accent font-medium">
                  ${Number(product.price).toFixed(2)}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <div className="px-3 py-2 bg-analog-surface-alt border-t border-analog-border">
        <p className="text-xs text-analog-text-faint">
          ↑↓ Navigate • Enter to select • Esc to close
        </p>
      </div>
    </div>
  );
}
