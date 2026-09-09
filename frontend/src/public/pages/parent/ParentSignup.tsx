import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { Users, UserPlus, Search, Info } from 'lucide-react';
import AuthShellLayout from '../../components/AuthShellLayout';
import FormFieldErrors from '../../components/FormFieldErrors';
import SuccessModal from '../../components/SuccessModal';
import SubmitButton from '../../components/SubmitButton';
import PasswordField from '../../components/PasswordField';
import { signupParent, searchStudentsForParentSignup, parseApiError, type PostLoginDestination } from '../../api/publicApi';

interface ChildResult {
  id: number;
  roll: string;
  first_name: string;
  last_name: string;
  class_name: string | null;
  already_linked: boolean;
  linked_parent_count: number;
  parent_capacity: number;
}

// Ports templates/school/parents/parentsignup.html verbatim for copy/field labels, and
// ParentUserForm + ParentExtraForm (school/forms.py) for field names/required-ness.
// The live child-search widget reproduces static/js/parent_signup.js's debounced search
// + chip-list UX; selected_student_ids is sent as a comma-joined string, matching
// ParentExtraForm.clean_selected_student_ids exactly. Auto-logs-in on success.
export default function ParentSignup() {
  const navigate = useNavigate();
  const [fields, setFields] = useState({
    first_name: '', last_name: '', username: '', email: '',
    password: '', password2: '', mobile: '', relationship: '',
  });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChildResult[] | null>(null);
  const [selected, setSelected] = useState<ChildResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [generalError, setGeneralError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [destination, setDestination] = useState<PostLoginDestination | null>(null);

  const set = (key: keyof typeof fields) => (e: ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Below the 2-character minimum, skip fetching entirely -- the results panel stays
    // hidden purely by the `query.trim().length >= 2` check in the render below, so
    // there's no need to also reset `results` synchronously here.
    if (trimmed.length < 2) return;

    debounceRef.current = setTimeout(() => {
      searchStudentsForParentSignup(trimmed)
        .then((res) => {
          if (latestQueryRef.current !== trimmed) return; // superseded by a newer search
          setResults(res.data.status === 'success' ? res.data.data : []);
        })
        .catch(() => setResults([]));
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const selectChild = (child: ChildResult) => {
    setSelected((prev) => (prev.some((c) => c.id === child.id) ? prev : [...prev, child]));
    setResults(null);
    setQuery('');
  };

  const removeChild = (id: number) => {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  };

  const goToDestination = (data: PostLoginDestination) => {
    if (data.destination === 'dashboard') navigate(data.path);
    else if (data.destination === 'wait-for-approval') {
      navigate('/wait-for-approval', { state: { role: data.role, visual_icon: data.visual_icon, wait_note: data.wait_note } });
    } else if (data.destination === 'external') window.location.href = data.url;
    else navigate('/portal');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldErrors(undefined);
    setGeneralError('');
    setSubmitting(true);
    try {
      const res = await signupParent({
        ...fields,
        selected_student_ids: selected.map((c) => c.id).join(','),
      });
      setSuccessMessage(res.data.message);
      if (res.data.destination) setDestination(res.data);
    } catch (err) {
      const data = parseApiError(err);
      if (data?.field_errors) setFieldErrors(data.field_errors);
      else setGeneralError(data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    if (destination) goToDestination(destination);
    else navigate('/parentlogin');
  };

  return (
    <AuthShellLayout role="parent" icon={Users} kind="REGISTRATION">
      <SuccessModal open={Boolean(successMessage)} message={successMessage} onClose={handleSuccessClose} />

      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 1.5, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff' }}>
          <Users size={26} />
        </Box>
        <Typography variant="h5" sx={{
          fontWeight: 800
        }}>Parent Registration</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Link your account to your child&apos;s profile.</Typography>
      </Box>

      <FormFieldErrors errors={fieldErrors} generalMessage={generalError} />

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Your First Name" value={fields.first_name} onChange={set('first_name')} required fullWidth placeholder="e.g. John" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Your Last Name" value={fields.last_name} onChange={set('last_name')} required fullWidth placeholder="e.g. Doe" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Create Username" value={fields.username} onChange={set('username')} required fullWidth
              placeholder="e.g. (studentname)_parent"
              helperText="Letters, numbers and @/./+/-/_ only. You'll use this to log in."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Email Address" type="email" value={fields.email} onChange={set('email')} required fullWidth
              placeholder="e.g. john@example.com"
              helperText="Used for password resets and school notifications."
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField
              label="Create Password" value={fields.password} onChange={set('password')} required fullWidth
              placeholder="Create a strong password" slotProps={{ htmlInput: { minLength: 8 } }}
              helperText="We recommend at least 8 characters, avoiding common words."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <PasswordField label="Confirm Password" value={fields.password2} onChange={set('password2')} required fullWidth placeholder="Repeat password" />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Parent Mobile Number" value={fields.mobile} onChange={set('mobile')} required fullWidth
              placeholder="e.g. 0722 000 000" helperText="A Kenyan mobile number the school can reach you on."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Relationship to Child" value={fields.relationship} onChange={set('relationship')} required fullWidth>
              <MenuItem value="Father">Father</MenuItem>
              <MenuItem value="Mother">Mother</MenuItem>
              <MenuItem value="Guardian">Guardian</MenuItem>
              <MenuItem value="Other">Other</MenuItem>
            </TextField>
          </Grid>

          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700,
                  mb: 0.5
                }}>Link Your Child(ren)</Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  mb: 2
                }}>
                Search by name or admission number and select each child below — you can link more than one.
              </Typography>

              <TextField
                label="Search for Your Child" value={query} onChange={(e) => setQuery(e.target.value)}
                fullWidth placeholder="Type a name or admission number..." autoComplete="off"
                slotProps={{ input: { startAdornment: <Search size={16} style={{ marginRight: 8, opacity: 0.6 }} /> } }}
              />

              {results !== null && query.trim().length >= 2 && (
                <Paper variant="outlined" sx={{ mt: 1, maxHeight: 260, overflowY: 'auto' }}>
                  {results.length === 0 ? (
                    <Box sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>No matching students found.</Typography>
                    </Box>
                  ) : (
                    results.map((s, i) => {
                      const isSelected = selected.some((c) => c.id === s.id);
                      let badgeText = 'Not Linked Yet';
                      let badgeColor: 'default' | 'success' | 'warning' = 'default';
                      if (s.already_linked) {
                        badgeText = s.parent_capacity > 1 ? 'Both Parents Linked' : 'Already Linked';
                        badgeColor = 'success';
                      } else if (s.linked_parent_count > 0) {
                        badgeText = `${s.linked_parent_count} of ${s.parent_capacity} Parents Linked`;
                        badgeColor = 'warning';
                      }
                      return (
                        <Box key={s.id}>
                          {i > 0 && <Divider />}
                          <Box
                            onClick={() => !isSelected && selectChild(s)}
                            sx={{
                              p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              cursor: isSelected ? 'default' : 'pointer',
                              '&:hover': isSelected ? undefined : { bgcolor: 'action.hover' },
                            }}
                          >
                            <Box>
                              <Typography variant="body2" sx={{
                                fontWeight: 600
                              }}>{s.first_name} {s.last_name}</Typography>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>
                                Admission No. {s.roll}{s.class_name ? ` · ${s.class_name}` : ''}
                              </Typography>
                            </Box>
                            <Chip size="small" label={isSelected ? 'Selected' : badgeText} color={isSelected ? 'primary' : badgeColor} variant="outlined" />
                          </Box>
                        </Box>
                      );
                    })
                  )}
                </Paper>
              )}

              {selected.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{
                    flexWrap: "wrap",
                    mt: 2
                  }}>
                  {selected.map((c) => (
                    <Chip
                      key={c.id}
                      label={`${c.first_name} ${c.last_name} (${c.roll})`}
                      onDelete={() => removeChild(c.id)}
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              ) : (
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{
                    alignItems: "flex-start",
                    color: "text.secondary",
                    mt: 2
                  }}>
                  <Info size={14} style={{ marginTop: 3, flexShrink: 0 }} />
                  <Typography variant="caption">No children linked yet — search above and select at least one.</Typography>
                </Stack>
              )}
            </Paper>
          </Grid>

          <Grid size={12}>
            <Stack spacing={2}>
              <SubmitButton
                icon={<UserPlus size={18} />}
                idleLabel="Register & Verify"
                busyLabel="Registering…"
                successLabel="Registered"
                submitting={submitting}
                succeeded={false}
              />
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  textAlign: "center"
                }}>
                Already registered? <Link component={RouterLink} to="/parentlogin" sx={{
                fontWeight: 600
              }}>Access Portal</Link>
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </AuthShellLayout>
  );
}
