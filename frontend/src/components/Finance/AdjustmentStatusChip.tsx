import { Chip } from '@mui/material';
import type { StudentFeeAdjustment } from '../../libs/financeApi';

const STATUS_LABELS: Record<StudentFeeAdjustment['status'], string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
};

const STATUS_COLOR: Record<StudentFeeAdjustment['status'], 'warning' | 'success' | 'default'> = {
  pending: 'warning', approved: 'success', rejected: 'default',
};

/** Status chip for a fee adjustment row (pending / approved / rejected). Reusable on any
 * statement or list page that shows adjustments. */
export function AdjustmentStatusChip({ status }: { status: StudentFeeAdjustment['status'] }) {
  return <Chip label={STATUS_LABELS[status]} color={STATUS_COLOR[status]} size="small" />;
}

export default AdjustmentStatusChip;
