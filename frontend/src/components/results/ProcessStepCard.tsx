import { Alert, Avatar, Card, CardContent, CardHeader } from '@mui/material';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

interface ProcessStepCardProps {
  step: number;
  title: string;
  subheader?: string;
  locked: boolean;
  lockedReason?: string;
  children: ReactNode;
}

export default function ProcessStepCard({ step, title, subheader, locked, lockedReason, children }: ProcessStepCardProps) {
  return (
    <Card variant="outlined" sx={{ opacity: locked ? 0.7 : 1, transition: 'opacity 0.2s' }}>
      <CardHeader
        avatar={
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: locked ? 'grey.400' : 'primary.main' }}>
            {step}
          </Avatar>
        }
        title={title}
        subheader={subheader}
      />
      <CardContent>
        {locked
          ? <Alert severity="info" icon={<Lock size={18} />}>{lockedReason ?? 'Complete the previous step first.'}</Alert>
          : children}
      </CardContent>
    </Card>
  );
}
