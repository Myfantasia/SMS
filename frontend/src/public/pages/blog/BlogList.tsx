import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import GradientWord from '../../components/GradientWord';
import { Newspaper, ArrowRight } from 'lucide-react';
import { fetchBlogPosts } from '../../api/publicApi';

interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  cover_image: string | null;
  author_name: string;
  published_at: string;
}

const FALLBACK: Omit<BlogPostSummary, 'slug'>[] = [
  {
    title: 'Inside the Silicon Savannah Coding Lab',
    excerpt: 'A look at how Grade 9 CBC learners are building their first apps alongside Westlands tech mentors.',
    cover_image: null,
    author_name: 'MyFantasia Team',
    published_at: new Date().toISOString(),
  },
  {
    title: 'What Changes When Your School Goes Digital',
    excerpt: "Attendance, results, and fee balances move in real time now -- here's what that actually looks like for a parent.",
    cover_image: null,
    author_name: 'MyFantasia Team',
    published_at: new Date().toISOString(),
  },
  {
    title: 'Preparing for the CBC Grade 9 Transition',
    excerpt: 'A practical guide for parents navigating the move from the 8-4-4 legacy track into CBC pathways.',
    cover_image: null,
    author_name: 'MyFantasia Team',
    published_at: new Date().toISOString(),
  },
];

export default function BlogList() {
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);

  useEffect(() => {
    fetchBlogPosts().then((res) => setPosts(res.data.posts)).catch(() => setPosts([]));
  }, []);

  const isReal = Boolean(posts && posts.length > 0);
  const cards: (BlogPostSummary | Omit<BlogPostSummary, 'slug'>)[] = isReal ? posts! : FALLBACK;

  return (
    <Box>
      <Box sx={{ background: 'radial-gradient(circle at 15% 10%, rgba(224,166,58,0.14), transparent 60%)', py: { xs: 6, md: 9 } }}>
        <Container maxWidth="md" sx={{ textAlign: 'center' }}>
          <Chip icon={<Newspaper size={14} />} label="MYFANTASIA JOURNAL" sx={{ mb: 3, fontWeight: 700 }} />
          <Typography variant="h2" sx={{ fontSize: { xs: '2.2rem', md: '3rem' }, fontWeight: 800, mb: 2 }}>
            Blog &amp; <GradientWord>Article Center</GradientWord>
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mx: 'auto' }}>
            Stories from the classroom, updates on the platform, and guidance for parents and
            guardians navigating the CBC and 8-4-4 pathways together.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        {posts === null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {!isReal && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4, textAlign: 'center', fontStyle: 'italic' }}>
                No articles have been published yet -- here's a preview of what's coming.
              </Typography>
            )}
            <Grid container spacing={3}>
              {cards.map((post, i) => {
                const slug = 'slug' in post ? post.slug : undefined;
                const media = post.cover_image ? (
                  <Box component="img" src={post.cover_image} alt="" sx={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <Box sx={{ width: '100%', aspectRatio: '16/9', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                    <Newspaper size={32} color="#E0A63A" style={{ opacity: 0.7 }} />
                  </Box>
                );
                const body = (
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{post.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{post.excerpt}</Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="text.secondary">By {post.author_name}</Typography>
                      {slug && <ArrowRight size={16} />}
                    </Stack>
                  </CardContent>
                );
                return (
                  <Grid key={slug ?? i} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Card sx={{ height: '100%' }}>
                      {slug ? (
                        <CardActionArea component={RouterLink} to={`/blog/${slug}`} sx={{ height: '100%' }}>
                          {media}{body}
                        </CardActionArea>
                      ) : (<>{media}{body}</>)}
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </>
        )}
      </Container>
    </Box>
  );
}
