import { createContext, useContext, useState, ReactNode, useCallback } from 'react';

export interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  storeId: string | null;
  storeName: string | null;
  addItem: (storeId: string, storeName: string, item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);

  const addItem = useCallback((newStoreId: string, newStoreName: string, item: Omit<CartItem, 'quantity'>) => {
    // If switching stores, clear cart
    if (storeId && storeId !== newStoreId) {
      setItems([{ ...item, quantity: 1 }]);
      setStoreId(newStoreId);
      setStoreName(newStoreName);
      return;
    }

    setStoreId(newStoreId);
    setStoreName(newStoreName);
    setItems(prev => {
      const existing = prev.find(i => i.menuItemId === item.menuItemId);
      if (existing) {
        return prev.map(i => i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, [storeId]);

  const removeItem = useCallback((menuItemId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.menuItemId !== menuItemId);
      if (next.length === 0) {
        setStoreId(null);
        setStoreName(null);
      }
      return next;
    });
  }, []);

  const updateQuantity = useCallback((menuItemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(menuItemId);
      return;
    }
    setItems(prev => prev.map(i => i.menuItemId === menuItemId ? { ...i, quantity } : i));
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
    setStoreId(null);
    setStoreName(null);
  }, []);

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, storeId, storeName, addItem, removeItem, updateQuantity, clearCart, total, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
