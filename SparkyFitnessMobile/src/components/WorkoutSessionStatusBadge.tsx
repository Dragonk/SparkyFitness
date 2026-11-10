import React from 'react';
import { View, Text } from 'react-native';
import type { WorkoutSessionStatus } from '@workspace/shared';

const STATUS_LABELS: Record<WorkoutSessionStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  partial: 'Partial',
  completed: 'Completed',
};

const STATUS_STYLES: Record<WorkoutSessionStatus, { bg: string; text: string }> = {
  planned: { bg: 'bg-blue-500/15', text: 'text-blue-500' },
  in_progress: { bg: 'bg-amber-500/15', text: 'text-amber-500' },
  partial: { bg: 'bg-orange-500/15', text: 'text-orange-500' },
  completed: { bg: 'bg-green-500/15', text: 'text-green-500' },
};

const WorkoutSessionStatusBadge: React.FC<{ status: WorkoutSessionStatus }> = ({ status }) => {
  const style = STATUS_STYLES[status];
  return (
    <View className={`px-2 py-0.5 rounded-full ${style.bg}`}>
      <Text className={`text-xs font-semibold ${style.text}`}>{STATUS_LABELS[status]}</Text>
    </View>
  );
};

export default WorkoutSessionStatusBadge;
