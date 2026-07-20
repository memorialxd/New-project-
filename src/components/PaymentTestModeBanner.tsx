const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken?.startsWith('pk_test_')) return null;
  return (
    <div className="w-full bg-warning/15 border-b border-warning/40 px-4 py-1.5 text-center text-xs text-warning-foreground">
      🧪 Δοκιμαστική λειτουργία πληρωμών — κανένα πραγματικό χρήμα δεν χρεώνεται.{' '}
      <a
        href="https://docs.lovable.dev/features/payments#test-and-live-environments"
        target="_blank"
        rel="noopener noreferrer"
        className="underline font-medium"
      >
        Μάθε περισσότερα
      </a>
    </div>
  );
}
