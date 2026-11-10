import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import Icon from '../components/Icon';
import Button from '../components/ui/Button';
import CollapsibleSection from '../components/CollapsibleSection';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import {
  useWorkoutPlan,
  useUpdateWorkoutPlan,
  useDeleteWorkoutPlan,
} from '../hooks/useWorkoutPlans';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { WorkoutPlanAssignment } from '../types/workoutPlans';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'WorkoutPlanDetail'>;

export const DAY_NAMES_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WorkoutPlanDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { planId, plan: initialPlan } = route.params;
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  const { data: plan, isLoading, isError, refetch } = useWorkoutPlan(planId);
  const current = plan ?? initialPlan;
  const { updatePlanAsync, isPending: isSaving } = useUpdateWorkoutPlan();
  const { deletePlanAsync, isPending: isDeleting } = useDeleteWorkoutPlan();

  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({});
  const toggleDay = useCallback((day: number) => {
    setExpandedDays((prev) => ({ ...prev, [day]: !prev[day] }));
  }, []);

  const assignmentsByDay = useMemo(() => {
    const map = new Map<number, WorkoutPlanAssignment[]>();
    for (const a of current.assignments ?? []) {
      const list = map.get(a.day_of_week) ?? [];
      list.push(a);
      map.set(a.day_of_week, list);
    }
    for (const list of map.values()) {
      list.sort((x, y) => x.sort_order - y.sort_order);
    }
    return map;
  }, [current.assignments]);

  const toggleActive = useCallback(() => {
    void updatePlanAsync({
      id: current.id,
      payload: {
        plan_name: current.plan_name,
        description: current.description ?? null,
        start_date: current.start_date ?? null,
        end_date: current.end_date ?? null,
        is_active: !current.is_active,
        assignments: current.assignments ?? [],
      },
    });
  }, [current, updatePlanAsync]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete Workout Plan?',
      'The plan will be removed. Planned future sessions from this plan are removed too; sessions already started or completed are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deletePlanAsync(current.id).then(() => navigation.goBack());
          },
        },
      ],
    );
  }, [current.id, deletePlanAsync, navigation]);

  if (isError && !plan) {
    return (
      <StatusView
        icon="cloud-offline"
        title="Could not load this workout plan"
        action={{ label: 'Retry', onPress: () => void refetch(), variant: 'primary' }}
      />
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: usesNativeHeader ? 8 : 16,
        paddingBottom: insets.bottom + activeWorkoutBarPadding + 24,
      }}
    >
      {isLoading && !plan ? (
        <StatusView loading title="Loading workout plan..." />
      ) : (
        <>
          <View className="bg-surface rounded-xl p-4 mb-3 shadow-sm">
            <Text className="text-xl font-bold text-text-primary mb-1">{current.plan_name}</Text>
            {current.description ? (
              <Text className="text-sm text-text-secondary mb-1">{current.description}</Text>
            ) : null}
            <Text className="text-xs text-text-muted">
              {current.start_date ?? '—'}
              {current.end_date ? ` → ${current.end_date}` : ''}
            </Text>
            <View className="flex-row items-center justify-between mt-3">
              <Text className="text-sm font-medium text-text-primary">
                {current.is_active ? 'Active' : 'Inactive'}
              </Text>
              <Switch value={!!current.is_active} disabled={isSaving} onValueChange={toggleActive} />
            </View>
            <Text className="text-xs text-text-muted mt-2">
              Plan edits regenerate only future planned sessions. Sessions already started, partial, or
              completed are never changed.
            </Text>
          </View>

          <View className="flex-row gap-2 mb-2">
            <View className="flex-1">
              <Button
                variant="secondary"
                disabled={isSaving}
                onPress={() => navigation.navigate('WorkoutPlanForm', { mode: 'edit-plan', plan: current })}
              >
                Edit
              </Button>
            </View>
            <View className="flex-1">
              <Button variant="outline" disabled={isDeleting} onPress={confirmDelete}>
                <Text style={{ color: '#dc2626', fontWeight: '600' }}>Delete</Text>
              </Button>
            </View>
          </View>

          <Text className="text-base font-semibold text-text-primary mt-2 mb-1">Days</Text>
          {DAY_NAMES_FULL.map((dayName, dayIndex) => {
            const items = assignmentsByDay.get(dayIndex) ?? [];
            return (
              <CollapsibleSection
                key={dayIndex}
                title={dayName}
                itemCount={items.length}
                expanded={!!expandedDays[dayIndex]}
                onToggle={() => toggleDay(dayIndex)}
              >
                {items.length === 0 ? (
                  <Text className="text-sm text-text-muted py-2">Rest day — no assignments.</Text>
                ) : (
                  items.map((a, idx) => (
                    <View
                      key={a.id ?? idx}
                      className="flex-row items-center justify-between py-2 border-b border-border-subtle"
                    >
                      <View className="flex-1 mr-2">
                        <Text className="text-sm font-medium text-text-primary" numberOfLines={1}>
                          {a.workout_preset_id ? a.workout_preset_name ?? 'Workout preset' : a.exercise_name ?? 'Exercise'}
                        </Text>
                        <Text className="text-xs text-text-muted">
                          {a.workout_preset_id ? 'Preset' : 'Exercise'}
                          {a.sets && a.sets.length > 0 ? ` • ${a.sets.length} sets` : ''}
                        </Text>
                      </View>
                      <Icon name="chevron-forward" size={16} color={textMuted} />
                    </View>
                  ))
                )}
              </CollapsibleSection>
            );
          })}
          <View style={{ height: 8 }} />
          <TouchableOpacity onPress={() => navigation.goBack()} className="py-3 flex-row items-center gap-2">
            <Icon name="chevron-back" size={18} color={accentPrimary} />
            <Text style={{ color: accentPrimary }}>Back to plans</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
};

export default WorkoutPlanDetailScreen;
