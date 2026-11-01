import { useEffect, useState } from 'react';
import { api } from './api';

export type Product = 'voice' | 'support';

let cached: Promise<Product> | null = null;
const load = () => (cached ??= api<{ product?: Product }>('/api/public/config').then((c) => c.product ?? 'support', () => 'support' as const));

/** The product this deployment presents; null until known, so the wrong landing page never flashes. */
export function useProduct(): Product | null {
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => {
    void load().then((p) => {
      if (p === 'voice') document.title = 'Relay Voice: your knowledge, your voice';
      setProduct(p);
    });
  }, []);
  return product;
}
