'use client';

import { useEffect, useState, useRef } from 'react';
import { Building2, Phone, Mail, Hash, MapPin, ExternalLink, Search, X, ChevronRight, User, ShoppingBag, Package } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Customer {
  id: string;
  customer_name: string;
  account_number: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  status: string;
  category: string;
  credit_limit: string;
  is_active: string;
  am_customer_id: string;
}

interface Order {
  id: string;
  apparel_magic_id: string;
  order_number: string;
  order_date: string;
  order_status: string;
  total_amount: number;
  ship_to_name: string;
  ship_to_address_1: string;
  ship_to_address_2: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
}

interface TopProduct {
  style_number: string;
  description: string;
  total_qty: number;
}

interface CustomerCardProps {
  email?: string;
  phone?: string;
  onCustomerLinked?: (name: string | null) => void;
}

const ADVANCE_HQ_URL = process.env.NEXT_PUBLIC_ADVANCE_HQ_URL || 'https://advance-hq.vercel.app';

export default function CustomerCard({ email, phone, onCustomerLinked }: CustomerCardProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!email && !phone) { setLoading(false); return; }
    loadCustomer();
  }, [email, phone]);

  async function loadCustomer() {
    setLoading(true);
    try {
      let linkQuery = supabase.from('thread_customer_links').select('customer_id');
      if (email) linkQuery = linkQuery.ilike('email', email);
      else if (phone) {
        const d = phone.replace(/\D/g, '');
        linkQuery = linkQuery.or(`phone.ilike.%${d}%,phone.ilike.%${phone}%`);
      }
      const { data: link } = await linkQuery.maybeSingle();

      if (link?.customer_id) {
        const { data: saved } = await supabase
          .from('customers')
          .select('id, customer_name, account_number, email, phone, city, state, country, status, category, credit_limit, is_active, am_customer_id')
          .eq('id', link.customer_id)
          .single();
        if (saved) {
          setCustomer(saved);
          onCustomerLinked?.(saved.customer_name);
          loadOrdersAndProducts(saved.id);
          setLoading(false);
          return;
        }
      }

      let matchQuery = supabase
        .from('customers')
        .select('id, customer_name, account_number, email, phone, city, state, country, status, category, credit_limit, is_active, am_customer_id');
      if (email) matchQuery = matchQuery.ilike('email', email);
      else if (phone) {
        const d = phone.replace(/\D/g, '');
        matchQuery = matchQuery.or(`phone.ilike.%${d}%,phone.ilike.%${phone}%`);
      }
      const { data: matched } = await matchQuery.maybeSingle();
      setCustomer(matched || null);
      onCustomerLinked?.(matched?.customer_name || null);
      if (matched) loadOrdersAndProducts(matched.id);
    } catch {
      setCustomer(null);
      onCustomerLinked?.(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrdersAndProducts(customerId: string) {
    // Resolve apparel_magic_customer_id
    const { data: customerData } = await supabase
      .from('customers')
      .select('am_customer_id')
      .eq('id', customerId)
      .single();
    const amId = customerData?.am_customer_id;
    if (!amId) return;

    // 5 most recent orders
    const { data: recentOrders } = await supabase
      .from('orders')
      .select('id, apparel_magic_id, order_number, order_date, order_status, total_amount, ship_to_name, ship_to_address_1, ship_to_address_2, ship_to_city, ship_to_state, ship_to_zip')
      .eq('apparel_magic_customer_id', amId)
      .order('order_date', { ascending: false })
      .limit(5);

    setOrders(recentOrders || []);

    // Top 5 products — exclude shipping line items
    if (recentOrders && recentOrders.length > 0) {
      const orderIds = recentOrders.map(o => o.id);

      // Pull all order IDs for this customer, then fetch all line items
      const { data: allOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('apparel_magic_customer_id', amId);

      const allOrderIds = allOrders?.map(o => o.id) || [];

      const { data: allItems } = allOrderIds.length > 0
        ? await supabase
            .from('order_items')
            .select('style_number, description, quantity_ordered')
            .in('order_id', allOrderIds)
        : { data: [] };

      if (allItems) {
        const productMap = new Map<string, { description: string; total_qty: number }>();

        for (const item of allItems) {
          const sn = (item.style_number || '').trim();
          const desc = (item.description || '').toLowerCase();

          // Skip shipping / misc line items
          if (!sn) continue;
          if (desc.includes('ship') || desc.includes('freight') || desc.includes('handling') || sn.toLowerCase().includes('ship')) continue;

          const existing = productMap.get(sn);
          const qty = item.quantity_ordered || 0;
          if (existing) {
            existing.total_qty += qty;
          } else {
            productMap.set(sn, { description: item.description || sn, total_qty: qty });
          }
        }

        const sorted = [...productMap.entries()]
          .sort((a, b) => b[1].total_qty - a[1].total_qty)
          .slice(0, 5)
          .map(([style_number, v]) => ({ style_number, description: v.description, total_qty: v.total_qty }));

        setTopProducts(sorted);
      }
    }
  }

  async function saveLink(selected: Customer) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const record: Record<string, string> = { customer_id: selected.id, linked_by: user?.id || '' };
      if (email) record.email = email.toLowerCase();
      if (phone) record.phone = phone;
      await supabase.from('thread_customer_links').upsert(record, { onConflict: email ? 'email' : 'phone' });
    } catch (err) {
      console.error('Failed to save customer link:', err);
    }
  }

  async function handleSelectCustomer(selected: Customer) {
    setCustomer(selected);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    onCustomerLinked?.(selected.customer_name);
    loadOrdersAndProducts(selected.id);
    await saveLink(selected);
  }

  async function handleUnlink() {
    try {
      if (email) await supabase.from('thread_customer_links').delete().ilike('email', email);
      else if (phone) {
        const d = phone.replace(/\D/g, '');
        await supabase.from('thread_customer_links').delete().or(`phone.ilike.%${d}%,phone.ilike.%${phone}%`);
      }
    } catch (err) { console.error('Failed to unlink:', err); }
    setCustomer(null);
    setOrders([]);
    setTopProducts([]);
    onCustomerLinked?.(null);
    setShowSearch(true);
  }

  async function searchCustomers(q: string) {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data } = await supabase
        .from('customers')
        .select('id, customer_name, account_number, email, phone, city, state, status')
        .or(`customer_name.ilike.%${q}%,email.ilike.%${q}%,account_number.ilike.%${q}%`)
        .limit(8);
      setSearchResults((data as Customer[]) || []);
    } catch { setSearchResults([]); } finally { setSearching(false); }
  }

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 100);
  }, [showSearch]);

  const statusColor = (status: string) => {
    if (!status) return 'bg-stone-100 text-stone-500';
    const s = status.toLowerCase();
    if (s === 'active') return 'bg-emerald-50 text-emerald-700';
    if (s === 'inactive') return 'bg-stone-100 text-stone-500';
    return 'bg-amber-50 text-amber-700';
  };

  const orderStatusColor = (status: string) => {
    if (!status) return 'text-stone-400';
    const s = status.toLowerCase();
    if (s === 'open') return 'text-blue-600';
    if (s === 'shipped' || s === 'complete') return 'text-emerald-600';
    if (s === 'cancelled' || s === 'canceled') return 'text-red-400';
    return 'text-stone-500';
  };

  if (loading) {
    return (
      <div className="border-t border-stone-100 pt-4 mt-4">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Customer</p>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-stone-100 rounded w-3/4" />
          <div className="h-3 bg-stone-100 rounded w-1/2" />
          <div className="h-3 bg-stone-100 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (customer) {
    const addressLine1 = customer.city || customer.state
      ? [customer.city, customer.state].filter(Boolean).join(', ')
      : null;

    return (
      <div className="border-t border-stone-100 pt-4 mt-4 space-y-4">

        {/* Customer info card */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Customer</p>
            <button onClick={handleUnlink} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">Change</button>
          </div>

          <div className="bg-stone-50 rounded-xl p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-[#c17f6b]/15 flex items-center justify-center flex-shrink-0">
                  <Building2 size={14} className="text-[#c17f6b]" />
                </div>
                <span className="text-sm font-semibold text-stone-800 truncate leading-tight">{customer.customer_name}</span>
              </div>
              {customer.status && (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor(customer.status)}`}>
                  {customer.status}
                </span>
              )}
            </div>

            {customer.account_number && (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Hash size={11} className="flex-shrink-0" />
                <span className="font-mono">{customer.account_number}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-xs text-stone-500 min-w-0">
                <Mail size={11} className="flex-shrink-0" />
                <span className="truncate">{customer.email}</span>
              </div>
            )}

            {customer.phone && (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Phone size={11} className="flex-shrink-0" />
                <span>{customer.phone}</span>
              </div>
            )}

            {/* Full address */}
            {(customer.city || customer.state || customer.country) && (
              <div className="flex items-start gap-2 text-xs text-stone-500">
                <MapPin size={11} className="flex-shrink-0 mt-0.5" />
                <span className="leading-snug">
                  {[customer.city, customer.state].filter(Boolean).join(', ')}
                  {customer.country && customer.country !== 'US' && customer.country !== 'USA' && (
                    <span className="block text-stone-400">{customer.country}</span>
                  )}
                </span>
              </div>
            )}

            {customer.credit_limit && (
              <div className="flex items-center justify-between text-xs pt-1 border-t border-stone-200">
                <span className="text-stone-400">Credit limit</span>
                <span className="font-medium text-stone-700">${Number(customer.credit_limit).toLocaleString()}</span>
              </div>
            )}
          </div>

          <a
            href={`${ADVANCE_HQ_URL}/customers/${customer.am_customer_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#c17f6b] hover:bg-[#b06d5a] text-white text-xs font-medium transition-colors group"
          >
            <span>View in Advance HQ</span>
            <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        </div>

        {/* Recent orders */}
        {orders.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Recent Orders</p>
            <div className="space-y-1.5">
              {orders.map(order => (
                <a
                  key={order.id}
                  href={`${ADVANCE_HQ_URL}/orders/${order.apparel_magic_id || order.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 bg-stone-50 rounded-lg hover:bg-stone-100 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#c17f6b] group-hover:underline font-mono">
                        #{order.order_number}
                      </span>
                      <span className={`text-[10px] font-medium ${orderStatusColor(order.order_status)}`}>
                        {order.order_status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {order.order_date && (
                        <span className="text-[10px] text-stone-400">
                          {new Date(order.order_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                        </span>
                      )}
                      {order.total_amount != null && (
                        <>
                          <span className="text-[10px] text-stone-300">•</span>
                          <span className="text-[10px] text-stone-500 font-medium">${Number(order.total_amount).toLocaleString()}</span>
                        </>
                      )}
                    </div>
                    {order.ship_to_city && (
                      <span className="text-[10px] text-stone-400 block mt-0.5">
                        {[order.ship_to_address_1, order.ship_to_city, order.ship_to_state, order.ship_to_zip].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                  <ExternalLink size={10} className="text-stone-300 group-hover:text-stone-500 flex-shrink-0 ml-2 transition-colors" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Top products */}
        {topProducts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Top Products</p>
            <div className="space-y-1.5">
              {topProducts.map(product => (
                <div key={product.style_number} className="flex items-center justify-between px-3 py-2 bg-stone-50 rounded-lg">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-stone-700 font-mono">{product.style_number}</span>
                    {product.description && product.description !== product.style_number && (
                      <p className="text-[10px] text-stone-400 truncate mt-0.5">{product.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-stone-500 flex-shrink-0 ml-2">
                    {product.total_qty.toLocaleString()} units
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    );
  }

  // No customer found state
  return (
    <div className="border-t border-stone-100 pt-4 mt-4">
      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Customer</p>

      {!showSearch ? (
        <div className="bg-stone-50 rounded-xl p-3 text-center">
          <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center mx-auto mb-2">
            <User size={14} className="text-stone-400" />
          </div>
          <p className="text-xs text-stone-500 mb-2">No customer found for this {email ? 'email' : 'number'}</p>
          <button
            onClick={() => setShowSearch(true)}
            className="text-xs font-medium text-[#c17f6b] hover:text-[#b06d5a] transition-colors flex items-center gap-1 mx-auto"
          >
            <Search size={11} />
            Link to a customer
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name or account #"
              className="w-full pl-8 pr-8 py-2 text-xs bg-stone-100 rounded-lg border border-transparent focus:border-[#c17f6b] focus:bg-white outline-none transition-all placeholder:text-stone-400"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                <X size={12} />
              </button>
            )}
          </div>

          {searching && <p className="text-xs text-stone-400 text-center py-2">Searching...</p>}

          {!searching && searchResults.length > 0 && (
            <div className="bg-stone-50 rounded-xl overflow-hidden divide-y divide-stone-100">
              {searchResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCustomer(c)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-stone-100 transition-colors text-left group"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-800 truncate">{c.customer_name}</p>
                    <p className="text-[10px] text-stone-400 font-mono">{c.account_number}</p>
                  </div>
                  <ChevronRight size={12} className="text-stone-300 group-hover:text-stone-500 flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}

          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-stone-400 text-center py-2">No customers found</p>
          )}

          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
            className="text-xs text-stone-400 hover:text-stone-600 transition-colors w-full text-center"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
