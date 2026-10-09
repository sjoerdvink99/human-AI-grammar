import type { Project, Workspace } from '../../../shared/types';
import type { useJobs } from '../api';

export interface ViewProps {
  project: Project;
  setProject: (p: Project) => void;
  jobs: ReturnType<typeof useJobs>;
  reload: () => Promise<void>;
}
export interface WsProps extends ViewProps {
  ws: Workspace;
}
