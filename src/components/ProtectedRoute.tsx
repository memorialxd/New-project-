import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading, profile, isAdmin, isSupport } = useAuth();

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground font-heading">Loading...</p>
        </div>
      </div>
    );
  }


  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Admins have access to every protected route
  if (isAdmin) return <>{children}</>;

  if (allowedRoles?.includes('admin')) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles?.includes('support')) {
    if (!isSupport) return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    if (profile.role === 'driver') return <Navigate to="/driver" replace />;
    if (profile.role === 'store') return <Navigate to="/store" replace />;
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
