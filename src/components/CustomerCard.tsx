'use client';

import { useEffect, useState, useRef } from 'react';
import { Building2, Phone, Mail, Hash, MapPin, ExternalLink, Search, X, ChevronRight, User } from 'lucide-react';
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

interface CustomerCardProps {
  email?: string;
  phone?: string;
}

const ADVANCE_HQ_URL = process.env.NEXT_PUBLIC_ADVANCE_HQ_URL || 'https://advance-hq.vercel.app';

export default function CustomerCard({ email, phone }: CustomerCardProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!email && !phone) {
      setLoading(false);
      return;
    }
    loadCustomer();
  }, [email, phone]);

  // Step 1: Check for a saved link, then fall back to auto-match by email/phone
  async function loadCustomer() {
    setLoading(true);
    try {
      // Check saved link first
      let linkQuery = supabase
        .from('thread_customer_links')
        .select('customer_id');

      if (email) {
        linkQuery = linkQuery.ilike('email', email);
      } else if (phone) {
        const digitsOnly = phone.replace(/\D/g, '');
        linkQuery = linkQuery.or(`phone.ilike.%${digitsOnly}%,phone.ilike.%${phone}%`);
      }

      const { data: link } = await linkQuery.maybeSingle();

      if (link?.customer_id) {
        // Load the full customer from the saved link
        const { data: savedCustomer } = await supabase
          .from('customers')
          .select('id, customer_name, account_number, email, phone, city, state, country, status, category, credit_limit, is_active, am_customer_id')
          .eq('id', link.customer_id)
          .single();
        if (savedCustomer) {
          setCustomer(savedCustomer);
          setLoading(false);
          return;
        }
      }

      // No saved link — try auto-match by email or phone
      let matchQuery = supabase
        .from('customers')
        .select('id, customer_name, account_number, email, phone, city, state, country, status, category, credit_limit, is_active, am_customer_id');

      if (email) {
        matchQuery = matchQuery.ilike('email', email);
      } else if (phone) {
        const digitsOnly = phone.replace(/\D/g, '');
        matchQuery = matchQuery.or(`phone.ilike.%${digitsOnly}%,phone.ilike.%${phone}%`);
      }

      const { data: matched } = await matchQuery.maybeSingle();
      setCustomer(matched || null);
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }

  // Save the link when a customer is manually selected
  async function saveLink(selected: Customer) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const record: Record<string, string> = {
        customer_id: selected.id,
        linked_by: user?.id || '',
      };
      if (email) record.email = email.toLowerCase();
      if (phone) record.phone = phone;

      await supabase
        .from('thread_customer_links')
        .upsert(record, { onConflict: email ? 'email' : 'phone' });
    } catch (err) {
      console.error('Failed to save customer link:', err);
    }
  }

  async function handleSelectCustomer(selected: Customer) {
    setCustomer(selected);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    await saveLink(selected);
  }

  async function handleUnlink() {
    try {
      if (email) {
        await supabase.from('thread_customer_links').delete().ilike('email', email);
      } else if (phone) {
        const digitsOnly = phone.replace(/\D/g, '');
        await supabase.from('thread_customer_links').delete().or(`phone.ilike.%${digitsOnly}%,phone.ilike.%${phone}%`);
      }
    } catch (err) {
      console.error('Failed to unlink customer:', err);
    }
    setCustomer(null);
    setShowSearch(true);
  }

  async function searchCustomers(q: string) {
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await supabase
        .from('customers')
        .select('id, customer_name, account_number, email, phone, city, state, status')
        .or(`customer_name.ilike.%${q}%,email.ilike.%${q}%,account_number.ilike.%${q}%`)
        .limit(8);

      setSearchResults((data as Customer[]) || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(searchQuery), 300);
    return () => clearTimeout(timer);
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
    return (
      <div className="border-t border-stone-100 pt-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Customer</p>
          <button
            onClick={handleUnlink}
            className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
          >
            Change
          </button>
        </div>

        <div className="bg-stone-50 rounded-xl p-3 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#c17f6b]/15 flex items-center justify-center flex-shrink-0">
                <Building2 size={14} className="text-[#c17f6b]" />
              </div>
              <span className="text-sm font-semibold text-stone-800 truncate leading-tight">
                {customer.customer_name}
              </span>
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

          {(customer.city || customer.state) && (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <MapPin size={11} className="flex-shrink-0" />
              <span>{[customer.city, customer.state].filter(Boolean).join(', ')}</span>
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
          href={`${ADVANCE_HQ_URL}/customers/${customer.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#c17f6b] hover:bg-[#b06d5a] text-white text-xs font-medium transition-colors group"
        >
          <span>View in Advance HQ</span>
          <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </a>
      </div>
    );
  }

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
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {searching && (
            <p className="text-xs text-stone-400 text-center py-2">Searching...</p>
          )}

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
