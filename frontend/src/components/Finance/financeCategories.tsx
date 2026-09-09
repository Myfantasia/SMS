import type { ReactNode } from 'react';
import {
  GraduationCap, ClipboardList, Bus, UtensilsCrossed, Gift, CircleDollarSign,
  Users, Zap, Wrench, BookOpen, Fuel, FileText, MoreHorizontal,
} from 'lucide-react';

export interface FinanceCategory {
  key: string;
  label: string;
  icon: ReactNode;
  // Tailwind chip classes, matching the low-opacity-dark-variant pattern used elsewhere.
  chip: string;
  bar: string;
}

// Realistic school income/expense line items. Amounts live in MOCK_FINANCE_BREAKDOWN below,
// keyed by `key` here -- when a real finance ledger exists, swap that mock object for a
// fetched one shaped the same way ({ income: {key: amount}, expense: {key: amount} }) and
// every screen that reads from this file keeps working unchanged.
export const INCOME_CATEGORIES: FinanceCategory[] = [
  { key: 'tuition_fees', label: 'Tuition Fees', icon: <GraduationCap className="w-4 h-4" />, chip: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  { key: 'boarding_fees', label: 'Boarding & Meals', icon: <UtensilsCrossed className="w-4 h-4" />, chip: 'bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400', bar: 'bg-teal-500' },
  { key: 'transport_fees', label: 'Transport Fees', icon: <Bus className="w-4 h-4" />, chip: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', bar: 'bg-cyan-500' },
  { key: 'registration_fees', label: 'Registration Fees', icon: <ClipboardList className="w-4 h-4" />, chip: 'bg-lime-50 dark:bg-lime-500/10 text-lime-600 dark:text-lime-400', bar: 'bg-lime-500' },
  { key: 'grants_donations', label: 'Grants & Donations', icon: <Gift className="w-4 h-4" />, chip: 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400', bar: 'bg-green-500' },
  { key: 'other_income', label: 'Other Income', icon: <CircleDollarSign className="w-4 h-4" />, chip: 'bg-slate-100 dark:bg-slate-500/10 text-slate-500 dark:text-slate-400', bar: 'bg-slate-400' },
];

export const EXPENSE_CATEGORIES: FinanceCategory[] = [
  { key: 'staff_salaries', label: 'Staff Salaries', icon: <Users className="w-4 h-4" />, chip: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400', bar: 'bg-red-500' },
  { key: 'maintenance', label: 'Maintenance & Repairs', icon: <Wrench className="w-4 h-4" />, chip: 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400', bar: 'bg-orange-500' },
  { key: 'utilities', label: 'Utilities', icon: <Zap className="w-4 h-4" />, chip: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  { key: 'learning_materials', label: 'Learning Materials', icon: <BookOpen className="w-4 h-4" />, chip: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' },
  { key: 'transport_fuel', label: 'Transport & Fuel', icon: <Fuel className="w-4 h-4" />, chip: 'bg-pink-50 dark:bg-pink-500/10 text-pink-600 dark:text-pink-400', bar: 'bg-pink-500' },
  { key: 'admin_licensing', label: 'Admin & Licensing', icon: <FileText className="w-4 h-4" />, chip: 'bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400', bar: 'bg-fuchsia-500' },
  { key: 'other_expenses', label: 'Other Expenses', icon: <MoreHorizontal className="w-4 h-4" />, chip: 'bg-slate-100 dark:bg-slate-500/10 text-slate-500 dark:text-slate-400', bar: 'bg-slate-400' },
];

// Shaped exactly like a real finance-ledger API response would be: { income: {category_key: amount}, expense: {category_key: amount} }.
export const MOCK_FINANCE_BREAKDOWN: { income: Record<string, number>; expense: Record<string, number> } = {
  income: {
    tuition_fees: 620000,
    boarding_fees: 96000,
    transport_fees: 38000,
    registration_fees: 45000,
    grants_donations: 30000,
    other_income: 12000,
  },
  expense: {
    staff_salaries: 410000,
    maintenance: 34000,
    utilities: 28000,
    learning_materials: 22000,
    transport_fuel: 26000,
    admin_licensing: 15000,
    other_expenses: 9000,
  },
};
