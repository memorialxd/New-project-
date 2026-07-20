import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface State { error: Error | null }

/**
 * Catches render errors inside lazy-loaded routes so the user sees a recovery
 * screen instead of a blank page. Reset by clicking "Try again" (clears state)
 * or "Reload" (full reload).
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('Route crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-xl border border-border bg-card p-6 shadow-sm text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h2 className="font-heading font-bold text-lg">Κάτι πήγε στραβά</h2>
            <p className="text-sm text-muted-foreground mt-1 break-words">
              {this.state.error.message || 'Απρόσμενο σφάλμα στη σελίδα.'}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Δοκίμασε ξανά
            </Button>
            <Button onClick={() => window.location.reload()}>Επαναφόρτωση</Button>
          </div>
        </div>
      </div>
    );
  }
}
