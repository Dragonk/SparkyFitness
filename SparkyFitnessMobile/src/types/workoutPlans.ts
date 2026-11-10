export interface WorkoutPlanAssignmentSet {
  id?: number;
  set_number: number;
  set_type?: string | null;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  rest_time?: number | null;
  notes?: string | null;
}

export interface WorkoutPlanAssignment {
  id?: number;
  day_of_week: number;
  sort_order: number;
  workout_preset_id?: number | null;
  workout_preset_name?: string | null;
  exercise_id?: string | null;
  exercise_name?: string | null;
  modality?: string | null;
  sets?: WorkoutPlanAssignmentSet[];
}

export interface WorkoutPlanTemplate {
  id: number;
  user_id?: string;
  plan_name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  assignments?: WorkoutPlanAssignment[];
}

export interface WorkoutPlanTemplatePayload {
  plan_name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean;
  assignments?: WorkoutPlanAssignment[];
  currentClientDate?: string;
}
