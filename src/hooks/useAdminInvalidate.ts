import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Centralised invalidation for admin dashboards. Call after any mutation that
 * affects orders, stores, drivers, treasury, or wallets so the panels refresh
 * without waiting for the next 30-second poll.
 */
export function useAdminInvalidate() {
  const qc = useQueryClient();

  const all = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['admin-orders'] });
    qc.invalidateQueries({ queryKey: ['admin-stores'] });
    qc.invalidateQueries({ queryKey: ['admin-profiles'] });
    qc.invalidateQueries({ queryKey: ['admin-earnings'] });
    qc.invalidateQueries({ queryKey: ['admin-driver-states'] });
    qc.invalidateQueries({ queryKey: ['admin-driver-wallets'] });
    qc.invalidateQueries({ queryKey: ['admin-treasury-overview'] });
    qc.invalidateQueries({ queryKey: ['admin-store-owed'] });
    qc.invalidateQueries({ queryKey: ['admin-cash-on-street'] });
  }, [qc]);

  return {
    all,
    orders: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-treasury-overview'] });
    }, [qc]),
    finances: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['admin-treasury-overview'] });
      qc.invalidateQueries({ queryKey: ['admin-store-owed'] });
      qc.invalidateQueries({ queryKey: ['admin-cash-on-street'] });
      qc.invalidateQueries({ queryKey: ['admin-driver-wallets'] });
    }, [qc]),
    users: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['admin-profiles'] });
      qc.invalidateQueries({ queryKey: ['admin-driver-profiles'] });
      qc.invalidateQueries({ queryKey: ['admin-user-roles'] });
    }, [qc]),
    stores: useCallback(() => {
      qc.invalidateQueries({ queryKey: ['admin-stores'] });
    }, [qc]),
  };
}
