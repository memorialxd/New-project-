import { useParams, Link, Navigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Shield, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

type LegalKey = "terms" | "privacy" | "refunds";

const COMPANY = {
  name: "Riverstone Flow",
  legal: "Riverstone Flow IKE",
  email: "support@riverstoneflow.gr",
  address: "Αθήνα, Ελλάδα",
  vat: "EL000000000",
};

const CONTENT: Record<LegalKey, { icon: any; el: { title: string; updated: string; sections: { h: string; p: string }[] }; en: { title: string; updated: string; sections: { h: string; p: string }[] } }> = {
  terms: {
    icon: FileText,
    el: {
      title: "Όροι Χρήσης",
      updated: "Τελευταία ενημέρωση: 30 Απριλίου 2026",
      sections: [
        { h: "1. Αποδοχή Όρων", p: `Η χρήση της πλατφόρμας ${COMPANY.name} (η «Πλατφόρμα») προϋποθέτει την πλήρη και ανεπιφύλακτη αποδοχή των παρόντων όρων. Εάν δεν συμφωνείτε, παρακαλούμε διακόψτε τη χρήση.` },
        { h: "2. Περιγραφή Υπηρεσίας", p: `Η Πλατφόρμα διασυνδέει πελάτες με καταστήματα εστίασης και ανεξάρτητους οδηγούς διανομής. Η ${COMPANY.legal} ενεργεί ως τεχνολογικός μεσάζων και δεν παρασκευάζει τρόφιμα.` },
        { h: "3. Λογαριασμός Χρήστη", p: "Είστε υπεύθυνοι για την ακρίβεια των στοιχείων σας και για την ασφάλεια των διαπιστευτηρίων σας. Πρέπει να είστε τουλάχιστον 18 ετών για να δημιουργήσετε λογαριασμό." },
        { h: "4. Παραγγελίες & Πληρωμές", p: "Οι τιμές, διαθεσιμότητα και χρόνοι παράδοσης ορίζονται από τα καταστήματα. Πληρωμές γίνονται μέσω Stripe ή μετρητών στον οδηγό. Με την υποβολή παραγγελίας συνάπτετε σύμβαση πώλησης απευθείας με το κατάστημα." },
        { h: "5. Υποχρεώσεις Οδηγών", p: "Οι οδηγοί είναι ανεξάρτητοι συνεργάτες, υπεύθυνοι για τα έγγραφα οχήματος, ασφάλιση, φορολογικές υποχρεώσεις και τήρηση ΚΟΚ." },
        { h: "6. Απαγορευμένες Συμπεριφορές", p: "Απαγορεύεται η χρήση της Πλατφόρμας για παράνομους σκοπούς, η παρενόχληση άλλων χρηστών, η υποβολή ψευδών παραγγελιών και η απόπειρα παράκαμψης μέτρων ασφαλείας." },
        { h: "7. Περιορισμός Ευθύνης", p: `Η ${COMPANY.legal} δεν ευθύνεται για ποιότητα τροφίμων, αλλεργικές αντιδράσεις, καθυστερήσεις λόγω κυκλοφοριακών συνθηκών ή ζημιές πέραν του ποσού της παραγγελίας.` },
        { h: "8. Τροποποιήσεις", p: "Διατηρούμε το δικαίωμα τροποποίησης των όρων με ειδοποίηση 30 ημερών μέσω email ή εντός της εφαρμογής." },
        { h: "9. Εφαρμοστέο Δίκαιο", p: "Οι παρόντες όροι διέπονται από το Ελληνικό Δίκαιο. Αρμόδια δικαστήρια είναι αυτά των Αθηνών." },
        { h: "10. Επικοινωνία", p: `Για ερωτήσεις: ${COMPANY.email} | ${COMPANY.address} | ΑΦΜ: ${COMPANY.vat}` },
      ],
    },
    en: {
      title: "Terms of Service",
      updated: "Last updated: April 30, 2026",
      sections: [
        { h: "1. Acceptance", p: `By using the ${COMPANY.name} platform (the "Platform"), you fully accept these terms. If you disagree, please discontinue use.` },
        { h: "2. Service Description", p: `The Platform connects customers with restaurants and independent delivery drivers. ${COMPANY.legal} acts as a technology intermediary and does not prepare food.` },
        { h: "3. User Account", p: "You are responsible for the accuracy of your information and the security of your credentials. You must be at least 18 years old." },
        { h: "4. Orders & Payments", p: "Prices, availability and delivery times are set by stores. Payments via Stripe or cash to the driver. Submitting an order forms a contract directly with the store." },
        { h: "5. Driver Obligations", p: "Drivers are independent contractors responsible for their vehicle documents, insurance, tax obligations and compliance with traffic laws." },
        { h: "6. Prohibited Conduct", p: "Use for illegal purposes, harassment, fake orders, or attempts to bypass security are forbidden." },
        { h: "7. Limitation of Liability", p: `${COMPANY.legal} is not liable for food quality, allergic reactions, traffic-related delays, or damages exceeding the order amount.` },
        { h: "8. Changes", p: "We may modify these terms with 30 days notice via email or in-app." },
        { h: "9. Governing Law", p: "These terms are governed by Greek law. Athens courts have exclusive jurisdiction." },
        { h: "10. Contact", p: `Questions: ${COMPANY.email} | ${COMPANY.address} | VAT: ${COMPANY.vat}` },
      ],
    },
  },
  privacy: {
    icon: Shield,
    el: {
      title: "Πολιτική Απορρήτου",
      updated: "Τελευταία ενημέρωση: 30 Απριλίου 2026",
      sections: [
        { h: "1. Υπεύθυνος Επεξεργασίας", p: `${COMPANY.legal}, ${COMPANY.address}. Email: ${COMPANY.email}.` },
        { h: "2. Δεδομένα που Συλλέγουμε", p: "Όνομα, email, τηλέφωνο, διευθύνσεις παράδοσης, ιστορικό παραγγελιών, στοιχεία πληρωμής (μέσω Stripe — δεν αποθηκεύουμε αριθμούς καρτών), τοποθεσία οδηγών κατά την παράδοση, αξιολογήσεις." },
        { h: "3. Νομική Βάση (GDPR Άρθρο 6)", p: "α) Εκτέλεση σύμβασης (παραγγελίες), β) Έννομο συμφέρον (πρόληψη απάτης), γ) Συγκατάθεση (marketing), δ) Νομική υποχρέωση (φορολογικά αρχεία)." },
        { h: "4. Διάρκεια Διατήρησης", p: "Παραγγελίες: 5 έτη (φορολογικός νόμος). Λογαριασμός: όσο είναι ενεργός. Δεδομένα τοποθεσίας οδηγών: 90 ημέρες. Αναλυτικά δεδομένα: ανώνυμα μετά τους 24 μήνες." },
        { h: "5. Διαμοιρασμός Δεδομένων", p: "Με καταστήματα (στοιχεία παραγγελίας), οδηγούς (όνομα, διεύθυνση παράδοσης, τηλέφωνο), Stripe (πληρωμές), Mapbox (χάρτες). Δεν πωλούμε δεδομένα τρίτους." },
        { h: "6. Δικαιώματά σας (GDPR)", p: `Πρόσβαση, διόρθωση, διαγραφή, φορητότητα, εναντίωση, περιορισμός. Στείλτε αίτημα στο ${COMPANY.email}. Έχετε δικαίωμα καταγγελίας στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (www.dpa.gr).` },
        { h: "7. Cookies", p: "Χρησιμοποιούμε απαραίτητα cookies (συνεδρία) και προαιρετικά analytics. Μπορείτε να τα απορρίψετε από τις ρυθμίσεις του browser." },
        { h: "8. Ασφάλεια", p: "Κρυπτογράφηση TLS, Row-Level Security στη βάση δεδομένων, ρόλοι πρόσβασης, τακτικά security audits." },
        { h: "9. Παιδιά", p: "Η υπηρεσία δεν απευθύνεται σε άτομα κάτω των 18 ετών." },
      ],
    },
    en: {
      title: "Privacy Policy",
      updated: "Last updated: April 30, 2026",
      sections: [
        { h: "1. Data Controller", p: `${COMPANY.legal}, ${COMPANY.address}. Email: ${COMPANY.email}.` },
        { h: "2. Data We Collect", p: "Name, email, phone, delivery addresses, order history, payment details (via Stripe — we don't store card numbers), driver location during delivery, ratings." },
        { h: "3. Legal Basis (GDPR Art. 6)", p: "(a) Contract performance (orders), (b) Legitimate interest (fraud prevention), (c) Consent (marketing), (d) Legal obligation (tax records)." },
        { h: "4. Retention", p: "Orders: 5 years (tax law). Account: while active. Driver location data: 90 days. Analytics: anonymized after 24 months." },
        { h: "5. Sharing", p: "With stores (order details), drivers (name, address, phone), Stripe (payments), Mapbox (maps). We never sell data to third parties." },
        { h: "6. Your Rights (GDPR)", p: `Access, rectification, erasure, portability, objection, restriction. Send a request to ${COMPANY.email}. You may file complaints with the Hellenic Data Protection Authority (www.dpa.gr).` },
        { h: "7. Cookies", p: "We use essential session cookies and optional analytics. You can refuse via browser settings." },
        { h: "8. Security", p: "TLS encryption, Row-Level Security on the database, role-based access, regular audits." },
        { h: "9. Children", p: "The service is not directed at persons under 18." },
      ],
    },
  },
  refunds: {
    icon: RefreshCw,
    el: {
      title: "Πολιτική Επιστροφών",
      updated: "Τελευταία ενημέρωση: 30 Απριλίου 2026",
      sections: [
        { h: "1. Φύση των Προϊόντων", p: "Τα τρόφιμα είναι αναλώσιμα προϊόντα και εξαιρούνται από το δικαίωμα υπαναχώρησης 14 ημερών (Π.Δ. 131/2003, άρθρο 3θ)." },
        { h: "2. Πότε Δικαιούστε Επιστροφή", p: "α) Λάθος προϊόν, β) Σημαντικά κατεστραμμένα τρόφιμα κατά την παράδοση, γ) Ακύρωση από το κατάστημα, δ) Παράδοση που ποτέ δεν έγινε, ε) Σημαντική καθυστέρηση (>60 λεπτά πέραν της εκτίμησης)." },
        { h: "3. Διαδικασία", p: `Επικοινωνήστε με την υποστήριξη εντός 24 ωρών από την παράδοση μέσω της εφαρμογής (κουμπί «Υποστήριξη») ή στο ${COMPANY.email}. Επισυνάψτε φωτογραφίες αν υπάρχει ζημιά.` },
        { h: "4. Χρονικά Πλαίσια", p: "Απάντηση εντός 24 ωρών. Πιστώσεις στο πορτοφόλι: άμεσα. Επιστροφή στην κάρτα: 5-10 εργάσιμες ημέρες (Stripe)." },
        { h: "5. Μερικές Επιστροφές", p: "Μπορεί να προσφερθεί μερική επιστροφή ή πίστωση πορτοφολιού όταν μέρος της παραγγελίας ήταν ελαττωματικό." },
        { h: "6. Ακυρώσεις", p: "Δωρεάν ακύρωση πριν το κατάστημα αποδεχθεί την παραγγελία. Μετά την αποδοχή, χρέωση 100% αν τα τρόφιμα έχουν ήδη παρασκευαστεί." },
        { h: "7. Φιλοδωρήματα Οδηγών", p: "Φιλοδωρήματα είναι μη επιστρέψιμα εκτός εξαιρετικών περιπτώσεων (π.χ. μη παράδοση)." },
      ],
    },
    en: {
      title: "Refund Policy",
      updated: "Last updated: April 30, 2026",
      sections: [
        { h: "1. Nature of Goods", p: "Food is perishable and exempt from the 14-day withdrawal right (Greek P.D. 131/2003, art. 3θ)." },
        { h: "2. When You're Entitled to a Refund", p: "(a) Wrong item, (b) Significantly damaged food on delivery, (c) Store cancellation, (d) Delivery never made, (e) Significant delay (>60 min over estimate)." },
        { h: "3. Process", p: `Contact support within 24 hours of delivery via the in-app "Support" button or ${COMPANY.email}. Attach photos for damage claims.` },
        { h: "4. Timing", p: "Response within 24 hours. Wallet credits: instant. Card refunds: 5–10 business days (Stripe)." },
        { h: "5. Partial Refunds", p: "We may offer a partial refund or wallet credit when only part of the order was defective." },
        { h: "6. Cancellations", p: "Free cancellation before the store accepts. After acceptance, 100% charge if food has been prepared." },
        { h: "7. Driver Tips", p: "Tips are non-refundable except in exceptional cases (e.g. non-delivery)." },
      ],
    },
  },
};

export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const { lang: language } = useI18n();
  const { profile } = useAuth();
  const key = doc as LegalKey;

  if (!CONTENT[key]) return <Navigate to="/" replace />;

  const data = CONTENT[key];
  const lang = (language === "en" ? "en" : "el") as "el" | "en";
  const c = data[lang];
  const Icon = data.icon;

  const roleHome: Record<string, { path: string; el: string; en: string }> = {
    customer: { path: "/order", el: "Παραγγελία", en: "Order" },
    store:    { path: "/store",  el: "Κατάστημα", en: "Store" },
    driver:   { path: "/driver", el: "Οδηγός",    en: "Driver" },
    admin:    { path: "/admin",  el: "Διαχείριση", en: "Admin" },
    support:  { path: "/support", el: "Υποστήριξη", en: "Support" },
  };
  const home = (profile?.role && roleHome[profile.role]) || { path: "/", el: "Αρχική", en: "Home" };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to={home.path}><ArrowLeft className="h-4 w-4 mr-1" />{home[lang]}</Link>
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <div className="h-9 w-9 rounded-lg bg-primary/10 grid place-items-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-heading font-bold text-lg">{c.title}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-xs text-muted-foreground mb-6">{c.updated}</p>
        <Card>
          <CardContent className="pt-6 space-y-6">
            {c.sections.map((s, i) => (
              <section key={i}>
                <h2 className="font-heading font-semibold text-base mb-2">{s.h}</h2>
                <p className="text-sm text-foreground/80 leading-relaxed">{s.p}</p>
              </section>
            ))}
          </CardContent>
        </Card>

        <nav className="mt-6 flex flex-wrap gap-2 justify-center">
          {(["terms", "privacy", "refunds"] as LegalKey[]).filter(k => k !== key).map(k => (
            <Button key={k} asChild variant="outline" size="sm">
              <Link to={`/legal/${k}`}>{CONTENT[k][lang].title}</Link>
            </Button>
          ))}
        </nav>
      </main>
    </div>
  );
}
