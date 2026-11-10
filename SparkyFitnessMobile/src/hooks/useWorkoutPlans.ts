import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  fetchWorkoutPlanTemplates,
  fetchWorkoutPlanTemplate,
  createWorkoutPlanTemplate,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
} from '../services/api/workoutPlanTemplatesApi';
import { invalidateExerciseCache } from './invalidateExerciseCache';
import { normalizeDate } from '../utils/dateUtils';
import type {
  WorkoutPlanTemplate,
  WorkoutPlanTemplatePayload,
} from '../types/workoutPlans';

export const workoutPlansQueryKey = ['workoutPlans'] as const;
export const workoutPlanDetailQueryKey = (id: number) =>
  [...workoutPlansQueryKey, 'detail', id] as const;

export function useWorkoutPlans() {
  return useQuery({
    queryKey: workoutPlansQueryKey,
    queryFn: fetchWorkoutPlanTemplates,
    staleTime: 1000 * 30,
  });
}

export function useWorkoutPlan(id: number | undefined) {
  return useQuery({
    queryKey: workoutPlanDetailQueryKey(id ?? 0),
    queryFn: () => fetchWorkoutPlanTemplate(id as number),
    enabled: id !== undefined,
  });
}

function usePlanMutation<T>(
  mutationFn: (payload: T) => Promise<WorkoutPlanTemplate>,
  successText: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workoutPlansQueryKey });
      // Plan changes regenerate future diary sessions server-side.
      invalidateExerciseCache(queryClient, normalizeDate(new Date().toISOString()));
      Toast.show({ type: 'success', text1: successText });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Workout plan change failed',
        text2: 'Please try again.',
      });
    },
  });
}

export function useCreateWorkoutPlan() {
  const mutation = usePlanMutation(
    (payload: WorkoutPlanTemplatePayload) => createWorkoutPlanTemplate(payload),
    'Workout plan created',
  );
  return { createPlanAsync: mutation.mutateAsync, isPending: mutation.isPending };
}

export function useUpdateWorkoutPlan() {
  const mutation = usePlanMutation(
    ({ id, payload }: { id: number; payload: WorkoutPlanTemplatePayload }) =>
      updateWorkoutPlanTemplate(id, payload),
    'Workout plan updated',
  );
  return { updatePlanAsync: mutation.mutateAsync, isPending: mutation.isPending };
}

export function useDeleteWorkoutPlan() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: number) => deleteWorkoutPlanTemplate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workoutPlansQueryKey });
      invalidateExerciseCache(queryClient, normalizeDate(new Date().toISOString()));
      Toast.show({ type: 'success', text1: 'Workout plan deleted' });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Failed to delete workout plan',
        text2: 'Please try again.',
      });
    },
  });
  return { deletePlanAsync: mutation.mutateAsync, isPending: mutation.isPending };
}
