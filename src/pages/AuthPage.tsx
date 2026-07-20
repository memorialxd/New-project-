import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Mail, Lock, User, Loader as Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SEO } from '@/components/SEO';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp, user, profile, isAdmin, isSupport } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && profile) {
      if (isAdmin) navigate('/admin', { replace: true });
      else if (isSupport) navigate('/support', { replace: true });
      else if (profile.role === 'driver') navigate('/driver', { replace: true });
      else if (profile.role === 'store') navigate('/store', { replace: true });
      else navigate('/order', { replace: true });
    }
  }, [user, profile, isAdmin, isSupport, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success('Καλώς ήρθατε ξανά!');
        }
      } else {
        if (!fullName.trim()) {
          toast.error('Παρακαλώ εισάγετε το όνομά σας');
          setSubmitting(false);
          return;
        }
        const { error } = await signUp(email, password, fullName, 'customer');
        if (error) {
          toast.error(error.message);
        } else {
          toast.success('Ο λογαριασμός δημιουργήθηκε! Ελέγξτε το email σας για επιβεβαίωση.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(220,20%,7%)] flex flex-col">
      <SEO
        title="Σύνδεση & Εγγραφή — Fresh Delivery"
        description="Συνδεθείτε ή δημιουργήστε λογαριασμό στο Fresh Delivery ως πελάτης, οδηγός ή κατάστημα και ξεκινήστε άμεσα."
        path="/auth"
      />
      <h1 className="sr-only">Σύνδεση & Εγγραφή στο Fresh Delivery</h1>
      {/* Header */}
      <header className="px-4 py-4 flex items-center justify-center">
        <span className="font-heading font-extrabold text-xl text-primary">Fresh Delivery</span>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-[var(--shadow-lg)] border-[hsl(220,20%,14%)] bg-[hsl(220,20%,10%)] animate-scale-in">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-heading text-2xl text-[hsl(220,14%,96%)]">
              {isLogin ? 'Καλώς Ήρθατε' : 'Δημιουργία Λογαριασμού'}
            </CardTitle>
            <p className="text-sm text-[hsl(220,10%,55%)] mt-1">
              {isLogin ? 'Συνδεθείτε για να συνεχίσετε' : 'Εγγραφείτε σε λίγα δευτερόλεπτα'}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="font-heading text-[hsl(220,14%,96%)]">Ονοματεπώνυμο</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(220,10%,55%)]" />
                    <Input
                      id="fullName"
                      placeholder="Το ονοματεπώνυμό σας"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="pl-10 bg-[hsl(220,20%,14%)] border-[hsl(220,20%,18%)] text-[hsl(220,14%,96%)] placeholder:text-[hsl(220,10%,40%)] focus-visible:ring-primary/40"
                      maxLength={100}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="font-heading text-[hsl(220,14%,96%)]">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(220,10%,55%)]" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-[hsl(220,20%,14%)] border-[hsl(220,20%,18%)] text-[hsl(220,14%,96%)] placeholder:text-[hsl(220,10%,40%)] focus-visible:ring-primary/40"
                    required
                    maxLength={255}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="font-heading text-[hsl(220,14%,96%)]">Κωδικός</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(220,10%,55%)]" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 bg-[hsl(220,20%,14%)] border-[hsl(220,20%,18%)] text-[hsl(220,14%,96%)] placeholder:text-[hsl(220,10%,40%)] focus-visible:ring-primary/40"
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-12 font-heading text-lg gradient-primary shadow-primary text-primary-foreground press-scale"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Παρακαλώ περιμένετε...
                  </>
                ) : isLogin ? 'Σύνδεση' : 'Δημιουργία Λογαριασμού'}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary hover:underline font-heading transition-colors"
              >
                {isLogin ? 'Δεν έχετε λογαριασμό; Εγγραφή' : 'Έχετε ήδη λογαριασμό; Σύνδεση'}
              </button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
