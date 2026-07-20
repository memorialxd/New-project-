import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Lang = 'el' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  // Common
  'common.search': { el: 'Αναζήτηση', en: 'Search' },
  'common.loading': { el: 'Φόρτωση...', en: 'Loading...' },
  'common.save': { el: 'Αποθήκευση', en: 'Save' },
  'common.cancel': { el: 'Ακύρωση', en: 'Cancel' },
  'common.confirm': { el: 'Επιβεβαίωση', en: 'Confirm' },
  'common.back': { el: 'Πίσω', en: 'Back' },
  'common.continue': { el: 'Συνέχεια', en: 'Continue' },
  'common.delete': { el: 'Διαγραφή', en: 'Delete' },

  // Customer app
  'customer.orders': { el: 'Παραγγελίες', en: 'Orders' },
  'customer.login': { el: 'Σύνδεση', en: 'Sign in' },
  'customer.search_placeholder': { el: 'Αναζήτηση καταστημάτων ή φαγητού', en: 'Search restaurants or food' },
  'customer.popular': { el: 'Δημοφιλή', en: 'Popular' },
  'customer.nearby': { el: 'Κοντινά Εστιατόρια', en: 'Nearby Restaurants' },
  'customer.no_results': { el: 'Δεν βρέθηκαν εστιατόρια', en: 'No restaurants found' },
  'customer.try_search': { el: 'Δοκιμάστε διαφορετική αναζήτηση', en: 'Try a different search' },
  'customer.check_back': { el: 'Ελέγξτε ξανά σύντομα', en: 'Check back soon' },
  'customer.stores_count': { el: 'καταστήματα', en: 'stores' },
  'customer.results_for': { el: 'Αποτελέσματα για', en: 'Results for' },
  'customer.delivery': { el: 'παράδοση', en: 'delivery' },
  'customer.busy': { el: 'Πολυάσχολο', en: 'Busy' },
  'customer.min': { el: 'λεπ', en: 'min' },
  'customer.profile': { el: 'Προφίλ', en: 'Profile' },
  'customer.wallet': { el: 'Πορτοφόλι', en: 'Wallet' },
  'customer.refer_friends': { el: 'Πρόσκληση φίλων', en: 'Invite friends' },

  // Categories
  'cat.all': { el: 'Όλα', en: 'All' },
  'cat.pizza': { el: 'Πίτσα', en: 'Pizza' },
  'cat.burgers': { el: 'Burgers', en: 'Burgers' },
  'cat.crepes': { el: 'Κρέπες', en: 'Crepes' },
  'cat.pasta': { el: 'Ζυμαρικά', en: 'Pasta' },
  'cat.gyros': { el: 'Σουβλάκια', en: 'Gyros' },
  'cat.salads': { el: 'Σαλάτες', en: 'Salads' },

  // Profile
  'profile.title': { el: 'Το Προφίλ μου', en: 'My Profile' },
  'profile.account': { el: 'Στοιχεία λογαριασμού', en: 'Account Details' },
  'profile.full_name': { el: 'Ονοματεπώνυμο', en: 'Full name' },
  'profile.phone': { el: 'Τηλέφωνο', en: 'Phone' },
  'profile.signout': { el: 'Αποσύνδεση', en: 'Sign out' },
  'profile.language': { el: 'Γλώσσα', en: 'Language' },
  'profile.appearance': { el: 'Εμφάνιση', en: 'Appearance' },
  'profile.dark_mode': { el: 'Σκοτεινή λειτουργία', en: 'Dark mode' },
  'profile.light': { el: 'Ανοιχτό', en: 'Light' },
  'profile.dark': { el: 'Σκοτεινό', en: 'Dark' },
  'profile.system': { el: 'Συστήματος', en: 'System' },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'el',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('app-lang') : null;
    if (stored === 'en' || stored === 'el') return stored;
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) return 'en';
    return 'el';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== 'undefined') localStorage.setItem('app-lang', l);
  };

  const t = (key: string) => translations[key]?.[lang] ?? key;

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useI18n().t;
}
