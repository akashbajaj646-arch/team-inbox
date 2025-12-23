'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Contact } from '@/types';

// Cache contacts to avoid repeated API calls
const contactCache: Map<string, Contact | null> = new Map();

export function useContactLookup() {
  const [loading, setLoading] = useState(false);

  const lookupByEmail = useCallback(async (email: string): Promise<Contact | null> => {
    if (!email) return null;
    
    const cacheKey = `email:${email.toLowerCase()}`;
    if (contactCache.has(cacheKey)) {
      return contactCache.get(cacheKey) || null;
    }

    try {
      const response = await fetch(`/api/contacts?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      const contact = data.contact || null;
      contactCache.set(cacheKey, contact);
      return contact;
    } catch (err) {
      console.error('Contact lookup error:', err);
      return null;
    }
  }, []);

  const lookupByPhone = useCallback(async (phone: string): Promise<Contact | null> => {
    if (!phone) return null;
    
    // Normalize phone for cache key
    const cleanPhone = phone.replace(/\D/g, '');
    const cacheKey = `phone:${cleanPhone}`;
    if (contactCache.has(cacheKey)) {
      return contactCache.get(cacheKey) || null;
    }

    try {
      const response = await fetch(`/api/contacts?phone=${encodeURIComponent(phone)}`);
      const data = await response.json();
      const contact = data.contact || null;
      contactCache.set(cacheKey, contact);
      return contact;
    } catch (err) {
      console.error('Contact lookup error:', err);
      return null;
    }
  }, []);

  const formatContactName = useCallback((contact: Contact | null): string | null => {
    if (!contact) return null;
    
    const parts = [];
    if (contact.first_name) parts.push(contact.first_name);
    if (contact.last_name) parts.push(contact.last_name);
    
    const name = parts.join(' ');
    
    if (name && contact.company_name) {
      return `${name} (${contact.company_name})`;
    }
    
    return name || contact.company_name || null;
  }, []);

  const clearCache = useCallback(() => {
    contactCache.clear();
  }, []);

  return {
    lookupByEmail,
    lookupByPhone,
    formatContactName,
    clearCache,
    loading,
  };
}

// Helper function to get display name from contact or fallback
export function getContactDisplayName(
  contact: Contact | null, 
  fallbackName: string | null,
  fallbackEmail?: string
): string {
  if (contact) {
    const parts = [];
    if (contact.first_name) parts.push(contact.first_name);
    if (contact.last_name) parts.push(contact.last_name);
    
    const name = parts.join(' ');
    
    if (name && contact.company_name) {
      return `${name} (${contact.company_name})`;
    }
    
    return name || contact.company_name || fallbackName || fallbackEmail || 'Unknown';
  }
  
  return fallbackName || fallbackEmail || 'Unknown';
}
