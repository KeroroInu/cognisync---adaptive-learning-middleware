export interface User {
  id: string;
  student_id: string;
  email?: string | null;
  name: string;
  role?: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
}

export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface LoginRequest {
  student_id: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  mode: 'scale' | 'ai';
}

export interface AuthResponse {
  token: string;
  user: User;
  initialProfile?: UserProfile;
}

export type AuthStatus = 'unknown' | 'authed' | 'guest';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  token: string | null;
}
