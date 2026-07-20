import { Leaf, Wheat, Flame, AlertTriangle } from 'lucide-react';

interface Props {
  isVegan?: boolean | null;
  isVegetarian?: boolean | null;
  isGlutenFree?: boolean | null;
  spicyLevel?: number | null;
  allergens?: string[] | null;
  calories?: number | null;
  size?: 'sm' | 'xs';
}

const ALLERGEN_LABEL_EL: Record<string, string> = {
  gluten: 'Γλουτένη',
  dairy: 'Γαλακτοκομικά',
  milk: 'Γαλακτοκομικά',
  eggs: 'Αυγά',
  egg: 'Αυγά',
  nuts: 'Ξηροί καρποί',
  peanuts: 'Φιστίκια',
  soy: 'Σόγια',
  fish: 'Ψάρι',
  shellfish: 'Οστρακοειδή',
  sesame: 'Σουσάμι',
  mustard: 'Μουστάρδα',
  celery: 'Σέλινο',
  sulphites: 'Θειώδη',
  lupin: 'Λούπινο',
  molluscs: 'Μαλάκια',
};

export function MenuItemBadges({
  isVegan, isVegetarian, isGlutenFree, spicyLevel, allergens, calories, size = 'xs',
}: Props) {
  const hasAny =
    isVegan || isVegetarian || isGlutenFree ||
    (spicyLevel ?? 0) > 0 ||
    (allergens && allergens.length > 0) ||
    calories;
  if (!hasAny) return null;

  const text = size === 'xs' ? 'text-[10px]' : 'text-xs';
  const pad = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';
  const icon = size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {isVegan && (
        <span className={`inline-flex items-center gap-0.5 ${pad} ${text} rounded-full bg-emerald-100 text-emerald-800 font-medium`}>
          <Leaf className={icon} /> Vegan
        </span>
      )}
      {!isVegan && isVegetarian && (
        <span className={`inline-flex items-center gap-0.5 ${pad} ${text} rounded-full bg-emerald-50 text-emerald-700 font-medium`}>
          <Leaf className={icon} /> Χορτοφαγικό
        </span>
      )}
      {isGlutenFree && (
        <span className={`inline-flex items-center gap-0.5 ${pad} ${text} rounded-full bg-amber-50 text-amber-800 font-medium`}>
          <Wheat className={icon} /> Χωρίς γλουτένη
        </span>
      )}
      {(spicyLevel ?? 0) > 0 && (
        <span className={`inline-flex items-center gap-0.5 ${pad} ${text} rounded-full bg-rose-50 text-rose-700 font-medium`}>
          <Flame className={icon} />
          {'🌶'.repeat(Math.min(spicyLevel ?? 1, 3))}
        </span>
      )}
      {calories ? (
        <span className={`inline-flex items-center ${pad} ${text} rounded-full bg-muted text-muted-foreground font-medium`}>
          {calories} kcal
        </span>
      ) : null}
      {allergens && allergens.length > 0 && (
        <span
          className={`inline-flex items-center gap-0.5 ${pad} ${text} rounded-full bg-orange-50 text-orange-800 font-medium`}
          title={allergens.map(a => ALLERGEN_LABEL_EL[a.toLowerCase()] ?? a).join(', ')}
        >
          <AlertTriangle className={icon} />
          Αλλεργιογόνα: {allergens.slice(0, 2).map(a => ALLERGEN_LABEL_EL[a.toLowerCase()] ?? a).join(', ')}
          {allergens.length > 2 ? ` +${allergens.length - 2}` : ''}
        </span>
      )}
    </div>
  );
}
