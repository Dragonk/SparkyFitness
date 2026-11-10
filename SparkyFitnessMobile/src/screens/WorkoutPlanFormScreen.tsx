import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import Icon from '../components/Icon';
import Button from '../components/ui/Button';
import FormInput from '../components/FormInput';
import CollapsibleSection from '../components/CollapsibleSection';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import {
  useCreateWorkoutPlan,
  useUpdateWorkoutPlan,
} from '../hooks/useWorkoutPlans';
import { useWorkoutPresets } from '../hooks/useWorkoutPresets';
import { searchExercises } from '../services/api/exerciseApi';
import { normalizeDate } from '../utils/dateUtils';
import type { Exercise } from '../types/exercise';
import type { WorkoutPreset } from '../types/workoutPresets';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanAssignmentSet,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'WorkoutPlanForm'>;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PickerMode = 'preset' | 'exercise' | null;

const emptySet = (n: number): WorkoutPlanAssignmentSet => ({
  set_number: n,
  set_type: 'Working Set',
  reps: null,
  weight: null,
});

const WorkoutPlanFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  const editingPlan: WorkoutPlanTemplate | undefined =
    route.params.mode === 'edit-plan' ? route.params.plan : undefined;

  const [planName, setPlanName] = useState(editingPlan?.plan_name ?? '');
  const [description, setDescription] = useState(editingPlan?.description ?? '');
  const [startDate, setStartDate] = useState(
    editingPlan?.start_date ?? normalizeDate(new Date().toISOString()),
  );
  const [endDate, setEndDate] = useState(editingPlan?.end_date ?? '');
  const [isActive, setIsActive] = useState(!!editingPlan?.is_active);
  const [assignments, setAssignments] = useState<WorkoutPlanAssignment[]>(
    (editingPlan?.assignments ?? []).map((a) => ({ ...a, sets: a.sets ? [...a.sets] : [] })),
  );
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({ 1: true });
  const [picker, setPicker] = useState<{ mode: PickerMode; day: number }>({ mode: null, day: 1 });
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [exerciseResults, setExerciseResults] = useState<Exercise[]>([]);

  const { presets } = useWorkoutPresets();

  const pickerItems: { id: string; name: string; preset?: WorkoutPreset; exercise?: Exercise }[] =
    picker.mode === 'preset'
      ? presets.map((p) => ({ id: String(p.id), name: p.name, preset: p }))
      : exerciseResults.map((e) => ({ id: e.id, name: e.name, exercise: e }));
  const { createPlanAsync, isPending: isCreating } = useCreateWorkoutPlan();
  const { updatePlanAsync, isPending: isUpdating } = useUpdateWorkoutPlan();
  const isSaving = isCreating || isUpdating;

  const toggleDay = useCallback((day: number) => {
    setExpandedDays((prev) => ({ ...prev, [day]: !prev[day] }));
  }, []);

  const dayAssignments = useCallback(
    (day: number) =>
      assignments.filter((a) => a.day_of_week === day).sort((a, b) => a.sort_order - b.sort_order),
    [assignments],
  );

  const addPresetAssignment = useCallback(
    (day: number, preset: WorkoutPreset) => {
      setAssignments((prev) => [
        ...prev,
        {
          day_of_week: day,
          sort_order: prev.filter((a) => a.day_of_week === day).length,
          workout_preset_id: preset.id,
          workout_preset_name: preset.name,
          exercise_id: null,
          sets: [],
        },
      ]);
      setPicker({ mode: null, day });
    },
    [],
  );

  const addExerciseAssignment = useCallback((day: number, exercise: Exercise) => {
    setAssignments((prev) => [
      ...prev,
      {
        day_of_week: day,
        sort_order: prev.filter((a) => a.day_of_week === day).length,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        modality: exercise.modality ?? null,
        workout_preset_id: null,
        sets: [emptySet(1), emptySet(2), emptySet(3)],
      },
    ]);
    setPicker({ mode: null, day });
  }, []);

  const removeAssignment = useCallback((day: number, target: WorkoutPlanAssignment) => {
    setAssignments((prev) => prev.filter((a) => a !== target));
  }, []);

  const moveAssignment = useCallback((day: number, index: number, direction: -1 | 1) => {
    setAssignments((prev) => {
      const dayItems = prev
        .filter((a) => a.day_of_week === day)
        .sort((a, b) => a.sort_order - b.sort_order);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= dayItems.length) return prev;
      const reordered = [...dayItems];
      const tmp = reordered[index]!;
      reordered[index] = reordered[targetIndex]!;
      reordered[targetIndex] = tmp;
      const orderByRef = new Map(reordered.map((a, i) => [a, i]));
      return prev.map((a) =>
        a.day_of_week === day && orderByRef.has(a)
          ? { ...a, sort_order: orderByRef.get(a)! }
          : a,
      );
    });
  }, []);

  const updateSet = useCallback(
    (target: WorkoutPlanAssignment, setIndex: number, field: 'reps' | 'weight', raw: string) => {
      const value = raw === '' ? null : Number(raw);
      setAssignments((prev) =>
        prev.map((a) =>
          a === target
            ? {
                ...a,
                sets: (a.sets ?? []).map((s, si) => (si === setIndex ? { ...s, [field]: value } : s)),
              }
            : a,
        ),
      );
    },
    [],
  );

  const addSet = useCallback((target: WorkoutPlanAssignment) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a !== target) return a;
        const sets = a.sets ?? [];
        return { ...a, sets: [...sets, emptySet(sets.length + 1)] };
      }),
    );
  }, []);

  const removeSet = useCallback((target: WorkoutPlanAssignment, setIndex: number) => {
    setAssignments((prev) =>
      prev.map((a) =>
        a === target
          ? {
              ...a,
              sets: (a.sets ?? [])
                .filter((_, si) => si !== setIndex)
                .map((s, si) => ({ ...s, set_number: si + 1 })),
            }
          : a,
      ),
    );
  }, []);

  const runExerciseSearch = useCallback(async (term: string) => {
    setExerciseSearch(term);
    if (term.trim().length < 2) {
      setExerciseResults([]);
      return;
    }
    try {
      const results = await searchExercises(term.trim());
      setExerciseResults(results);
    } catch {
      setExerciseResults([]);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!planName.trim()) {
      Alert.alert('Name required', 'Please enter a name for the workout plan.');
      return;
    }
    const payload = {
      plan_name: planName.trim(),
      description: description.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      is_active: isActive,
      assignments: assignments.map((a) => ({
        day_of_week: a.day_of_week,
        sort_order: a.sort_order ?? 0,
        workout_preset_id: a.workout_preset_id ?? null,
        exercise_id: a.exercise_id ?? null,
        sets: a.exercise_id ? (a.sets ?? []).map((s) => ({ ...s })) : undefined,
      })),
      currentClientDate: normalizeDate(new Date().toISOString()),
    };
    try {
      if (editingPlan) {
        await updatePlanAsync({ id: editingPlan.id, payload });
      } else {
        await createPlanAsync(payload);
      }
      navigation.goBack();
    } catch {
      // Toast is shown by the hook.
    }
  }, [planName, description, startDate, endDate, isActive, assignments, editingPlan, createPlanAsync, updatePlanAsync, navigation]);

  const renderAssignment = (day: number, a: WorkoutPlanAssignment, index: number) => (
    <View key={a.id ?? `${day}-${index}`} className="py-2 border-b border-border-subtle">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-text-primary flex-1 mr-2" numberOfLines={1}>
          {a.workout_preset_id ? a.workout_preset_name ?? 'Workout preset' : a.exercise_name ?? 'Exercise'}
        </Text>
        <View className="flex-row items-center gap-1">
          <TouchableOpacity onPress={() => moveAssignment(day, index, -1)} className="p-1.5">
            <Icon name="arrow-up" size={16} color={textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => moveAssignment(day, index, 1)} className="p-1.5">
            <Icon name="chevron-down" size={16} color={textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeAssignment(day, a)} className="p-1.5">
            <Icon name="trash" size={16} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
      {!a.workout_preset_id && (
        <View className="mt-1">
          {(a.sets ?? []).map((s, setIndex) => (
            <View key={setIndex} className="flex-row items-center gap-2 mb-1">
              <Text className="text-xs text-text-muted w-8">#{s.set_number}</Text>
              <FormInput
                className="flex-1"
                style={{ paddingVertical: 6 }}
                keyboardType="numeric"
                placeholder="Reps"
                value={s.reps != null ? String(s.reps) : ''}
                onChangeText={(t) => updateSet(a, setIndex, 'reps', t)}
              />
              <FormInput
                className="flex-1"
                style={{ paddingVertical: 6 }}
                keyboardType="numeric"
                placeholder="Weight"
                value={s.weight != null ? String(s.weight) : ''}
                onChangeText={(t) => updateSet(a, setIndex, 'weight', t)}
              />
              <TouchableOpacity onPress={() => removeSet(a, setIndex)} className="p-1">
                <Icon name="close" size={14} color="#dc2626" />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={() => addSet(a)} className="flex-row items-center gap-1 py-1">
            <Icon name="add" size={14} color={accentPrimary} />
            <Text style={{ color: accentPrimary }} className="text-xs font-medium">
              Add set
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + activeWorkoutBarPadding + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm font-medium text-text-secondary mb-1">Plan name</Text>
        <FormInput value={planName} onChangeText={setPlanName} placeholder="e.g. Push/Pull/Legs" className="mb-3" />

        <Text className="text-sm font-medium text-text-secondary mb-1">Description</Text>
        <FormInput value={description} onChangeText={setDescription} placeholder="Optional" className="mb-3" />

        <View className="flex-row gap-2 mb-3">
          <View className="flex-1">
            <Text className="text-sm font-medium text-text-secondary mb-1">Start date</Text>
            <FormInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-medium text-text-secondary mb-1">End date</Text>
            <FormInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD (optional)" autoCapitalize="none" />
          </View>
        </View>

        <View className="flex-row items-center justify-between bg-surface rounded-xl p-3 mb-3">
          <Text className="text-sm font-medium text-text-primary">Active</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>

        <Text className="text-base font-semibold text-text-primary mt-1 mb-1">Assignments by day</Text>
        {DAY_NAMES.map((dayName, dayIndex) => {
          const items = dayAssignments(dayIndex);
          return (
            <CollapsibleSection
              key={dayIndex}
              title={dayName}
              itemCount={items.length}
              expanded={!!expandedDays[dayIndex]}
              onToggle={() => toggleDay(dayIndex)}
            >
              {items.map((a, index) => renderAssignment(dayIndex, a, index))}
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity
                  className="flex-1 flex-row items-center justify-center gap-1 py-2 rounded-lg"
                  style={{ backgroundColor: `${accentPrimary}15` }}
                  onPress={() => setPicker({ mode: 'preset', day: dayIndex })}
                >
                  <Icon name="workout-settings" size={14} color={accentPrimary} />
                  <Text style={{ color: accentPrimary }} className="text-xs font-semibold">
                    Add preset
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 flex-row items-center justify-center gap-1 py-2 rounded-lg"
                  style={{ backgroundColor: `${accentPrimary}15` }}
                  onPress={() => setPicker({ mode: 'exercise', day: dayIndex })}
                >
                  <Icon name="add" size={14} color={accentPrimary} />
                  <Text style={{ color: accentPrimary }} className="text-xs font-semibold">
                    Add exercise
                  </Text>
                </TouchableOpacity>
              </View>
            </CollapsibleSection>
          );
        })}

        <Button variant="primary" disabled={isSaving} onPress={handleSave} className="mt-4">
          {editingPlan ? 'Save Changes' : 'Create Plan'}
        </Button>
      </ScrollView>

      <Modal
        visible={picker.mode !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker({ mode: null, day: 1 })}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View className="bg-surface rounded-t-2xl p-4" style={{ maxHeight: '70%' }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-semibold text-text-primary">
                {picker.mode === 'preset' ? 'Choose a workout preset' : 'Choose an exercise'}
              </Text>
              <TouchableOpacity onPress={() => setPicker({ mode: null, day: 1 })} className="p-1">
                <Icon name="close" size={20} color={textMuted} />
              </TouchableOpacity>
            </View>
            {picker.mode === 'exercise' && (
              <FormInput
                value={exerciseSearch}
                onChangeText={(t) => void runExerciseSearch(t)}
                placeholder="Search exercises..."
                className="mb-2"
                autoCapitalize="none"
              />
            )}
            <FlatList
              data={pickerItems}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  className="py-3 border-b border-border-subtle"
                  onPress={() => {
                    if (picker.mode === 'preset' && item.preset) {
                      addPresetAssignment(picker.day, item.preset);
                    } else if (picker.mode === 'exercise' && item.exercise) {
                      addExerciseAssignment(picker.day, item.exercise);
                    }
                  }}
                >
                  <Text className="text-sm text-text-primary" numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text className="text-sm text-text-muted py-4 text-center">
                  {picker.mode === 'preset' ? 'No presets found.' : 'Type at least 2 characters to search.'}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default WorkoutPlanFormScreen;
