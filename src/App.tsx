import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { CartProvider } from "@/hooks/useCart";
import { ThemeProvider } from "@/hooks/useTheme";
import { I18nProvider } from "@/lib/i18n";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import ConnectionStatus from "@/components/ConnectionStatus";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import Index from "./pages/Index.tsx";

// Lazy-load every non-landing route so the initial bundle stays small.
// This dramatically improves first paint across all apps.
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const DriverApp = lazy(() => import("./pages/DriverApp.tsx"));
const DriverProfilePage = lazy(() => import("./pages/DriverProfilePage.tsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.tsx"));
const StoreApp = lazy(() => import("./pages/StoreApp.tsx"));
const AdminApp = lazy(() => import("./pages/AdminApp.tsx"));
const SupportApp = lazy(() => import("./pages/SupportApp.tsx"));
const CustomerApp = lazy(() => import("./pages/CustomerApp.tsx"));
const RestaurantPage = lazy(() => import("./pages/RestaurantPage.tsx"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage.tsx"));
const OrderTrackingPage = lazy(() => import("./pages/OrderTrackingPage.tsx"));
const MyOrdersPage = lazy(() => import("./pages/MyOrdersPage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const LegalPage = lazy(() => import("./pages/LegalPage.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cost-aware defaults shared across all apps (customer, driver, store,
      // admin, support). Cuts duplicate fetches + auto-retries flaky requests
      // with backoff so a brief network blip doesn't surface as an error.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true, // resync when the device comes back online
      retry: (failureCount, err: any) => {
        // Don't retry auth / permission errors — they won't get better.
        const status = err?.status ?? err?.code;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      retryDelay: (i) => Math.min(1000 * 2 ** i, 8000),
    },
    mutations: {
      retry: 0,
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <CartProvider>
                <ConnectionStatus />
                <MaintenanceBanner />
                <Suspense fallback={<RouteFallback />}>
                  <RouteErrorBoundary>
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/order" element={<CustomerApp />} />
                    <Route path="/restaurant/:id" element={<RestaurantPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/order-tracking/:id" element={<OrderTrackingPage />} />
                    <Route path="/orders" element={<MyOrdersPage />} />
                    <Route path="/profile" element={
                      <ProtectedRoute>
                        <ProfilePage />
                      </ProtectedRoute>
                    } />
                    <Route path="/driver" element={
                      <ProtectedRoute allowedRoles={['driver']}>
                        <DriverApp />
                      </ProtectedRoute>
                    } />
                    <Route path="/driver/profile" element={
                      <ProtectedRoute allowedRoles={['driver']}>
                        <DriverProfilePage />
                      </ProtectedRoute>
                    } />
                    <Route path="/store" element={
                      <ProtectedRoute allowedRoles={['store']}>
                        <StoreApp />
                      </ProtectedRoute>
                    } />
                    <Route path="/admin" element={
                      <ProtectedRoute allowedRoles={['admin']}>
                        <AdminApp />
                      </ProtectedRoute>
                    } />
                    <Route path="/support" element={
                      <ProtectedRoute allowedRoles={['support']}>
                        <SupportApp />
                      </ProtectedRoute>
                    } />
                    <Route path="/legal/:doc" element={<LegalPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  </RouteErrorBoundary>
                </Suspense>
              </CartProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
