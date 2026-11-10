import { apiFetch } from './apiClient';
import type {
  WorkoutPlanTemplate,
  WorkoutPlanTemplatePayload,
} from '../../types/workoutPlans';

export const fetchWorkoutPlanTemplates = async (): Promise<WorkoutPlanTemplate[]> => {
  return apiFetch<WorkoutPlanTemplate[]>({
    endpoint: '/api/workout-plan-templates',
    serviceName: 'Workout Plans API',
    operation: 'fetch workout plans',
  });
};

export const fetchWorkoutPlanTemplate = async (
  id: number,
): Promise<WorkoutPlanTemplate> => {
  return apiFetch<WorkoutPlanTemplate>({
    endpoint: `/api/workout-plan-templates/${id}`,
    serviceName: 'Workout Plans API',
    operation: 'fetch workout plan',
  });
};

export const createWorkoutPlanTemplate = async (
  payload: WorkoutPlanTemplatePayload,
): Promise<WorkoutPlanTemplate> => {
  return apiFetch<WorkoutPlanTemplate>({
    endpoint: '/api/workout-plan-templates',
    serviceName: 'Workout Plans API',
    operation: 'create workout plan',
    method: 'POST',
    body: payload,
  });
};

export const updateWorkoutPlanTemplate = async (
  id: number,
  payload: WorkoutPlanTemplatePayload,
): Promise<WorkoutPlanTemplate> => {
  return apiFetch<WorkoutPlanTemplate>({
    endpoint: `/api/workout-plan-templates/${id}`,
    serviceName: 'Workout Plans API',
    operation: 'update workout plan',
    method: 'PUT',
    body: payload,
  });
};

export const deleteWorkoutPlanTemplate = async (id: number): Promise<void> => {
  return apiFetch<void>({
    endpoint: `/api/workout-plan-templates/${id}`,
    serviceName: 'Workout Plans API',
    operation: 'delete workout plan',
    method: 'DELETE',
  });
};

export const fetchActiveWorkoutPlanForDate = async (
  date: string,
): Promise<WorkoutPlanTemplate | null> => {
  return apiFetch<WorkoutPlanTemplate | null>({
    endpoint: `/api/workout-plan-templates/active/${date}`,
    serviceName: 'Workout Plans API',
    operation: 'fetch active workout plan',
  });
};
