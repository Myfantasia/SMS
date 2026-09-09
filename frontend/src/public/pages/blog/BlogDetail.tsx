import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import { ArrowLeft, Newspaper, TriangleAlert } from 'lucide-react';
import { fetchBlogPost } from '../../api/publicApi';

interface BlogPostDetail {
  title: string;
  body: string;
  cover_image: string | null;
  author_name: string;
  published_at: string;
}

export default function BlogDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setPost(null);
    setNotFound(false);
    fetchBlogPost(slug)
      .then((res) => setPost(res.data.post))
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 8, md: 12 }, textAlign: 'center' }}>
        <TriangleAlert size={40} color="#dc2626" style={{ marginBottom: 16 }} />
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Article not found</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          This article may have been unpublished or the link is incorrect.
        </Typography>
        <Button component={RouterLink} to="/blog" variant="outlined" startIcon={<ArrowLeft size={16} />}>
          Back to Blog
        </Button>
      </Container>
    );
  }

  if (!post) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {post.cover_image ? (
        <Box component="img" src={post.cover_image} alt="" sx={{ width: '100%', maxHeight: 420, objectFit: 'cover', display: 'block' }} />
      ) : (
        <Box sx={{ width: '100%', height: 240, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
          <Newspaper size={40} color="#E0A63A" style={{ opacity: 0.7 }} />
        </Box>
      )}

      <Container maxWidth="md" sx={{ py: { xs: 5, md: 7 } }}>
        <Button component={RouterLink} to="/blog" size="small" startIcon={<ArrowLeft size={14} />} sx={{ mb: 3 }}>
          Back to Blog
        </Button>

        <Typography variant="h2" sx={{ fontSize: { xs: '1.9rem', md: '2.6rem' }, fontWeight: 800, mb: 2 }}>
          {post.title}
        </Typography>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary', mb: 4 }}>
          <Typography variant="body2">By {post.author_name}</Typography>
          <Typography variant="body2">•</Typography>
          <Typography variant="body2">
            {new Date(post.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Typography>
        </Stack>

        <Divider sx={{ mb: 4 }} />

        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: '1.05rem' }}>
          {post.body}
        </Typography>
      </Container>
    </Box>
  );
}
