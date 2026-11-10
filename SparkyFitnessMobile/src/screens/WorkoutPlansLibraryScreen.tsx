import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import Icon from '../components/Icon';
import Button from '../components/ui/Button';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useWorkoutPlans, useUpdateWorkoutPlan } from '../hooks/useWorkoutPlans';
import { useRefetchOnFocus } from '../hooks';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { WorkoutPlanTemplate } from '../types/workoutPlans';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'WorkoutPlansLibrary'>;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WorkoutPlansLibraryScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  const { data: plans, isLoading, isError, refetch, isRefetching } = useWorkoutPlans();
  useRefetchOnFocus(refetch);
  const { updatePlanAsync, isPending: isUpdating } = useUpdateWorkoutPlan();

  const toggleActive = useCallback(
    (plan: WorkoutPlanTemplate) => {
      void updatePlanAsync({
        id: plan.id,
        payload: {
          plan_name: plan.plan_name,
          description: plan.description ?? null,
          start_date: plan.start_date ?? null,
          end_date: plan.end_date ?? null,
          is_active: !plan.is_active,
          assignments: plan.assignments ?? [],
        },
      });
    },
    [updatePlanAsync],
  );

  const renderItem = ({ item }: { item: WorkoutPlanTemplate }) => {
    const dayCount = new Set((item.assignments ?? []).map((a) => a.day_of_week)).size;
    const assignmentCount = item.assignments?.length ?? 0;
    const activeDays = DAY_NAMES.filter((_, i) =>
      (item.assignments ?? []).some((a) => a.day_of_week === i),
    ).join(', ');
    return (
      <TouchableOpacity
        className="bg-surface rounded-xl p-4 mb-2 shadow-sm"
        activeOpacity={0.7}
        onPress={() => navigation.navigate('WorkoutPlanDetail', { planId: item.id, plan: item })}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-text-primary flex-1 mr-2" numberOfLines={1}>
            {item.plan_name}
          </Text>
          <View className="flex-row items-center gap-2">
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: item.is_active ? `${accentPrimary}20` : `${textMuted}20` }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: item.is_active ? accentPrimary : textMuted }}
              >
                {item.is_active ? 'Active' : 'Inactive'}
              </Text>
            </View>
            <Switch
              value={!!item.is_active}
              disabled={isUpdating}
              onValueChange={() => toggleActive(item)}
            />
          </View>
        </View>
        {item.description ? (
          <Text className="text-sm text-text-secondary mt-1" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text className="text-xs text-text-muted mt-1">
          {item.start_date ?? '—'}
          {item.end_date ? ` → ${item.end_date}` : ''} • {assignmentCount} assignments on {dayCount}{' '}
          {dayCount === 1 ? 'day' : 'days'}
          {activeDays ? ` (${activeDays})` : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={plans ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: usesNativeHeader ? 8 : 16,
          paddingBottom: insets.bottom + activeWorkoutBarPadding + 80,
        }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListHeaderComponent={
          <View className="mb-2">
            <Button
              variant="primary"
              onPress={() => navigation.navigate('WorkoutPlanForm', { mode: 'create-plan' })}
            >
              New Workout Plan
            </Button>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <StatusView loading title="Loading workout plans..." />
          ) : isError ? (
            <StatusView
              icon="cloud-offline"
              title="Could not load workout plans"
              action={{ label: 'Retry', onPress: () => void refetch(), variant: 'primary' }}
            />
          ) : (
            <View className="items-center py-16">
              <Icon name="calendar" size={40} color={textMuted} />
              <Text className="text-text-muted mt-3 text-center px-8">
                No workout plans yet. Create one to schedule workouts across the week.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
};

export default WorkoutPlansLibraryScreen;
