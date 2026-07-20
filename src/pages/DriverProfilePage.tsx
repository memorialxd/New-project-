import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, User, Car, FileText, Landmark, Save, Loader as Loader2, Phone, Camera, Globe, Calendar, ShieldAlert, Shield, RefreshCw, Wallet, TrendingUp } from 'lucide-react';
import { DriverWallet } from '@/components/driver/DriverWallet';
import { EarningsDashboard } from '@/components/driver/EarningsDashboard';
import { Badge } from '@/components/ui/badge';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const SHIFTS = ['morning', 'afternoon', 'evening', 'night'] as const;
const SHIFT_LABELS: Record<string, string> = {
  morning: 'Πρωί (06–12)',
  afternoon: 'Μεσημέρι (12–18)',
  evening: 'Απόγευμα (18–24)',
  night: 'Νύχτα (00–06)',
};
const LANGUAGE_OPTIONS = ['Ελληνικά', 'English', 'Shqip', 'Русский', 'العربية', 'Français', 'Deutsch', 'Español', 'Italiano'];

interface DriverProfile {
  driver_code: string | null;
  vehicle_type: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number | null;
  vehicle_color: string;
  license_plate: string;
  license_number: string;
  license_expiry: string;
  bank_name: string;
  account_holder: string;
  iban: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  languages: string[];
  availability: { shifts?: string[] };
  date_of_birth: string;
  home_address: string;
  secondary_phone: string;
}

export default function DriverProfilePage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile>({
    driver_code: null,
    vehicle_type: 'motorcycle',
    vehicle_make: '',
    vehicle_model: '',
    vehicle_year: null,
    vehicle_color: '',
    license_plate: '',
    license_number: '',
    license_expiry: '',
    bank_name: '',
    account_holder: '',
    iban: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    languages: [],
    availability: { shifts: [] },
    date_of_birth: '',
    home_address: '',
    secondary_phone: '',
  });

  useEffect(() => {
    if (!user) return;
    setFullName(profile?.full_name || '');

    supabase.from('profiles').select('phone, avatar_url').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setPhone(data.phone || '');
          setAvatarUrl((data as any).avatar_url || null);
        }
      });

    supabase.from('driver_profiles').select('*').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) {
          const d: any = data;
          setDriverProfile({
            driver_code: d.driver_code || null,
            vehicle_type: d.vehicle_type || 'motorcycle',
            vehicle_make: d.vehicle_make || '',
            vehicle_model: d.vehicle_model || '',
            vehicle_year: d.vehicle_year,
            vehicle_color: d.vehicle_color || '',
            license_plate: d.license_plate || '',
            license_number: d.license_number || '',
            license_expiry: d.license_expiry || '',
            bank_name: d.bank_name || '',
            account_holder: d.account_holder || '',
            iban: d.iban || '',
            emergency_contact_name: d.emergency_contact_name || '',
            emergency_contact_phone: d.emergency_contact_phone || '',
            languages: Array.isArray(d.languages) ? d.languages : [],
            availability: d.availability || { shifts: [] },
            date_of_birth: d.date_of_birth || '',
            home_address: d.home_address || '',
            secondary_phone: d.secondary_phone || '',
          });
        }
        setLoading(false);
      });
  }, [user, profile]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Η εικόνα πρέπει να είναι κάτω από 5MB');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub.publicUrl;

      await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', user.id);
      setAvatarUrl(url);
      toast.success('Φωτογραφία ενημερώθηκε');
    } catch (err: any) {
      toast.error(err.message || 'Αποτυχία ανεβάσματος');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (section: string) => {
    if (!user) return;
    setSaving(true);
    try {
      if (section === 'personal') {
        await supabase.from('profiles').update({ full_name: fullName, phone }).eq('user_id', user.id);
      }

      const payload: any = {
        user_id: user.id,
        ...driverProfile,
        vehicle_year: driverProfile.vehicle_year || null,
        date_of_birth: driverProfile.date_of_birth || null,
        license_expiry: driverProfile.license_expiry || null,
      };

      const { error } = await supabase.from('driver_profiles').upsert(payload, { onConflict: 'user_id' });

      if (error) throw error;
      toast.success('Αποθηκεύτηκε επιτυχώς');
    } catch (e: any) {
      toast.error(e.message || 'Αποτυχία αποθήκευσης');
    } finally {
      setSaving(false);
    }
  };

  const toggleLanguage = (lang: string) => {
    setDriverProfile(p => ({
      ...p,
      languages: p.languages.includes(lang)
        ? p.languages.filter(l => l !== lang)
        : [...p.languages, lang],
    }));
  };

  const toggleShift = (shift: string) => {
    const current = driverProfile.availability?.shifts || [];
    setDriverProfile(p => ({
      ...p,
      availability: {
        ...p.availability,
        shifts: current.includes(shift) ? current.filter(s => s !== shift) : [...current, shift],
      },
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="gradient-dark text-primary-foreground px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/driver')}>
          <ArrowLeft className="h-5 w-5 text-primary-foreground/70 hover:text-primary-foreground" />
        </button>
        <h1 className="font-heading font-bold text-lg">Προφίλ Οδηγού</h1>
      </header>

      <div className="max-w-lg mx-auto p-4">
        {/* Avatar header */}
        <Card className="mb-4">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="relative">
              <div className="h-20 w-20 rounded-full bg-muted overflow-hidden border-2 border-primary/20 flex items-center justify-center">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full gradient-primary text-primary-foreground flex items-center justify-center shadow-md disabled:opacity-50"
                aria-label="Αλλαγή φωτογραφίας"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-bold truncate">{fullName || 'Οδηγός'}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              {driverProfile.driver_code && (
                <Badge variant="outline" className="mt-1 border-primary/30 text-primary font-mono text-[10px]">
                  {driverProfile.driver_code}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="personal">
          <TabsList className="w-full mb-4 grid grid-cols-7">
            <TabsTrigger value="personal" className="text-[10px] font-heading px-1">
              <User className="h-3 w-3 mr-0.5" />Προσ.
            </TabsTrigger>
            <TabsTrigger value="contact" className="text-[10px] font-heading px-1">
              <Phone className="h-3 w-3 mr-0.5" />Επαφή
            </TabsTrigger>
            <TabsTrigger value="vehicle" className="text-[10px] font-heading px-1">
              <Car className="h-3 w-3 mr-0.5" />Όχημα
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-[10px] font-heading px-1">
              <FileText className="h-3 w-3 mr-0.5" />Έγγρ.
            </TabsTrigger>
            <TabsTrigger value="bank" className="text-[10px] font-heading px-1">
              <Landmark className="h-3 w-3 mr-0.5" />Τράπ.
            </TabsTrigger>
            <TabsTrigger value="wallet" className="text-[10px] font-heading px-1">
              <Wallet className="h-3 w-3 mr-0.5" />Πορτ.
            </TabsTrigger>
            <TabsTrigger value="earnings" className="text-[10px] font-heading px-1">
              <TrendingUp className="h-3 w-3 mr-0.5" />Κέρδη
            </TabsTrigger>
          </TabsList>

          {/* PERSONAL */}
          <TabsContent value="personal">
            <Card>
              <CardHeader><CardTitle className="font-heading text-lg">Προσωπικά Στοιχεία</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="fullName">Ονοματεπώνυμο</Label>
                  <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="phone">Τηλέφωνο</Label>
                  <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+30 210 1234567" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={user?.email || ''} disabled className="bg-muted" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Ημ. Γέννησης</Label>
                    <Input
                      type="date"
                      value={driverProfile.date_of_birth}
                      onChange={e => setDriverProfile(p => ({ ...p, date_of_birth: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Δευτ. Τηλέφωνο</Label>
                    <Input
                      value={driverProfile.secondary_phone}
                      onChange={e => setDriverProfile(p => ({ ...p, secondary_phone: e.target.value }))}
                      placeholder="προαιρετικό"
                    />
                  </div>
                </div>
                <div>
                  <Label>Διεύθυνση Κατοικίας</Label>
                  <Textarea
                    value={driverProfile.home_address}
                    onChange={e => setDriverProfile(p => ({ ...p, home_address: e.target.value }))}
                    placeholder="Οδός, αριθμός, ΤΚ, πόλη"
                    rows={2}
                  />
                </div>

                {/* Availability */}
                <div>
                  <Label className="mb-2 block">Διαθεσιμότητα Βάρδιας</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {SHIFTS.map(s => {
                      const checked = (driverProfile.availability?.shifts || []).includes(s);
                      return (
                        <label
                          key={s}
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                            checked ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleShift(s)} />
                          <span className="text-xs font-heading">{SHIFT_LABELS[s]}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Languages */}
                <div>
                  <Label className="mb-2 flex items-center gap-1"><Globe className="h-3 w-3" /> Γλώσσες</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {LANGUAGE_OPTIONS.map(lang => {
                      const active = driverProfile.languages.includes(lang);
                      return (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => toggleLanguage(lang)}
                          className={`px-2.5 py-1 rounded-full text-xs font-heading border transition ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted border-border text-muted-foreground hover:bg-muted/70'
                          }`}
                        >
                          {lang}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button onClick={() => handleSave('personal')} disabled={saving} className="w-full gradient-primary text-primary-foreground font-heading">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Αποθήκευση Προσωπικών
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* EMERGENCY CONTACT */}
          <TabsContent value="contact">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                  Επαφή Έκτακτης Ανάγκης
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Σε περίπτωση ατυχήματος ή έκτακτης ανάγκης, η ομάδα υποστήριξης θα επικοινωνήσει με αυτό το άτομο.
                </p>
                <div>
                  <Label>Όνομα Επαφής</Label>
                  <Input
                    value={driverProfile.emergency_contact_name}
                    onChange={e => setDriverProfile(p => ({ ...p, emergency_contact_name: e.target.value }))}
                    placeholder="π.χ. Μαρία Παπαδοπούλου"
                  />
                </div>
                <div>
                  <Label>Τηλέφωνο Επαφής</Label>
                  <Input
                    value={driverProfile.emergency_contact_phone}
                    onChange={e => setDriverProfile(p => ({ ...p, emergency_contact_phone: e.target.value }))}
                    placeholder="+30 69X XXXX XXX"
                  />
                </div>
                <Button onClick={() => handleSave('contact')} disabled={saving} className="w-full gradient-primary text-primary-foreground font-heading">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Αποθήκευση Επαφής
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* VEHICLE */}
          <TabsContent value="vehicle">
            <Card>
              <CardHeader><CardTitle className="font-heading text-lg">Στοιχεία Οχήματος</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Τύπος Οχήματος</Label>
                  <Select value={driverProfile.vehicle_type} onValueChange={v => setDriverProfile(p => ({ ...p, vehicle_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="motorcycle">Μοτοσικλέτα</SelectItem>
                      <SelectItem value="bicycle">Ποδήλατο</SelectItem>
                      <SelectItem value="car">Αυτοκίνητο</SelectItem>
                      <SelectItem value="scooter">Σκούτερ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Μάρκα</Label>
                    <Input value={driverProfile.vehicle_make} onChange={e => setDriverProfile(p => ({ ...p, vehicle_make: e.target.value }))} placeholder="Honda" />
                  </div>
                  <div>
                    <Label>Μοντέλο</Label>
                    <Input value={driverProfile.vehicle_model} onChange={e => setDriverProfile(p => ({ ...p, vehicle_model: e.target.value }))} placeholder="CBR" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Έτος</Label>
                    <Input type="number" value={driverProfile.vehicle_year ?? ''} onChange={e => setDriverProfile(p => ({ ...p, vehicle_year: e.target.value ? Number(e.target.value) : null }))} placeholder="2023" />
                  </div>
                  <div>
                    <Label>Χρώμα</Label>
                    <Input value={driverProfile.vehicle_color} onChange={e => setDriverProfile(p => ({ ...p, vehicle_color: e.target.value }))} placeholder="Μαύρο" />
                  </div>
                </div>
                <div>
                  <Label>Πινακίδα</Label>
                  <Input value={driverProfile.license_plate} onChange={e => setDriverProfile(p => ({ ...p, license_plate: e.target.value }))} placeholder="ΑΒΓ-1234" />
                </div>
                <Button onClick={() => handleSave('vehicle')} disabled={saving} className="w-full gradient-primary text-primary-foreground font-heading">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Αποθήκευση Οχήματος
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DOCUMENTS */}
          <TabsContent value="documents">
            <Card>
              <CardHeader><CardTitle className="font-heading text-lg">Έγγραφα</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Αριθμός Διπλώματος</Label>
                  <Input value={driverProfile.license_number} onChange={e => setDriverProfile(p => ({ ...p, license_number: e.target.value }))} placeholder="DL-123456789" />
                </div>
                <div>
                  <Label>Λήξη Διπλώματος</Label>
                  <Input type="date" value={driverProfile.license_expiry} onChange={e => setDriverProfile(p => ({ ...p, license_expiry: e.target.value }))} />
                </div>
                <p className="text-xs text-muted-foreground">Η μεταφόρτωση εγγράφων θα είναι σύντομα διαθέσιμη. Επικοινωνήστε με την υποστήριξη για υποβολή ταυτότητας και διπλώματος.</p>
                <Button onClick={() => handleSave('documents')} disabled={saving} className="w-full gradient-primary text-primary-foreground font-heading">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Αποθήκευση Εγγράφων
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* BANK */}
          <TabsContent value="bank">
            <Card>
              <CardHeader><CardTitle className="font-heading text-lg">Τραπεζικά Στοιχεία</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Τράπεζα</Label>
                  <Input value={driverProfile.bank_name} onChange={e => setDriverProfile(p => ({ ...p, bank_name: e.target.value }))} placeholder="Εθνική Τράπεζα" />
                </div>
                <div>
                  <Label>Δικαιούχος Λογαριασμού</Label>
                  <Input value={driverProfile.account_holder} onChange={e => setDriverProfile(p => ({ ...p, account_holder: e.target.value }))} placeholder="Γιάννης Παπαδόπουλος" />
                </div>
                <div>
                  <Label>IBAN</Label>
                  <Input value={driverProfile.iban} onChange={e => setDriverProfile(p => ({ ...p, iban: e.target.value }))} placeholder="GR1234567890123456" />
                </div>
                <Button onClick={() => handleSave('bank')} disabled={saving} className="w-full gradient-primary text-primary-foreground font-heading">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Αποθήκευση Τραπεζικών
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* WALLET */}
          <TabsContent value="wallet">
            <DriverWallet />
          </TabsContent>

          {/* EARNINGS */}
          <TabsContent value="earnings">
            <EarningsDashboard />
          </TabsContent>
        </Tabs>

        {/* Legal links */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Νομικά Έγγραφα
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Link
              to="/legal/terms"
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              Όροι Χρήσης
            </Link>
            <Link
              to="/legal/privacy"
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Shield className="h-4 w-4 text-muted-foreground" />
              Πολιτική Απορρήτου
            </Link>
            <Link
              to="/legal/refunds"
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              Πολιτική Επιστροφών
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
