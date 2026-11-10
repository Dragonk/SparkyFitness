import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { WorkoutSessionStatus } from '@workspace/shared';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<WorkoutSessionStatus, string> = {
  planned:
    'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',
  in_progress:
    'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  partial:
    'border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800',
  completed:
    'border-green-200 bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
};

const WorkoutSessionStatusBadge: React.FC<{
  status: WorkoutSessionStatus;
  className?: string;
}> = ({ status, className }) => {
  const { t } = useTranslation();
  const label = t(
    `workoutSessionStatus.${status}`,
    {
      planned: 'Planned',
      in_progress: 'In progress',
      partial: 'Partial',
      completed: 'Completed',
    }[status]
  );
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', STATUS_STYLES[status], className)}
    >
      {label}
    </Badge>
  );
};

export default WorkoutSessionStatusBadge;
