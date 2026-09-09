import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { DAWN_GOLD } from '../theme/publicTheme';

export interface GallerySlide {
  src: string;
  tag: string;
  title: string;
  body: string;
}

interface Props {
  slides: GallerySlide[];
  intervalMs?: number;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function ImagePaginationGallery({ slides, intervalMs = 5000 }: Props) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!prefersReducedMotion());
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, intervalMs, slides.length]);

  const go = (next: number) => setIndex(((next % slides.length) + slides.length) % slides.length);

  const slide = slides[index];

  return (
    <Box
      onMouseEnter={() => setPlaying(false)}
      onMouseLeave={() => setPlaying(!prefersReducedMotion())}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        touchStartX.current = null;
      }}
      sx={{
        position: 'relative', borderRadius: 5, overflow: 'hidden', border: '1px solid', borderColor: 'divider',
        height: { xs: 380, sm: 440, md: 480 }, bgcolor: 'action.hover',
      }}
    >
      {slides.map((s, i) => (
        <Box
          key={s.src}
          component="img"
          src={s.src}
          alt={s.title}
          sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
            opacity: i === index ? 1 : 0,
            transition: prefersReducedMotion() ? 'none' : 'opacity 0.7s ease',
          }}
        />
      ))}

      {/* Readability scrim */}
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(13,18,16,0) 40%, rgba(13,18,16,0.85) 100%)' }} />

      {/* Content */}
      <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, p: { xs: 3, md: 4.5 }, color: '#fff' }}>
        <Chip
          label={slide.tag}
          size="small"
          sx={{ mb: 1.5, bgcolor: DAWN_GOLD, color: '#1A1400', fontWeight: 700 }}
        />
        <Typography
          variant="h4"
          sx={{
            fontSize: { xs: '1.4rem', md: '1.9rem' }, mb: 1, color: '#fff',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {slide.title}
        </Typography>
        <Typography
          variant="body1"
          sx={{
            maxWidth: 560, opacity: 0.9, fontSize: { xs: '0.9rem', md: '1rem' },
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {slide.body}
        </Typography>
      </Box>

      {/* Prev / Next arrows -- pinned to the upper band of the image, never the
          bottom caption zone, since caption height varies with title/body length. */}
      <IconButton
        aria-label="Previous"
        onClick={() => go(index - 1)}
        sx={{
          position: 'absolute', top: '32%', left: 12, transform: 'translateY(-50%)',
          bgcolor: 'rgba(13,18,16,0.45)', color: '#fff', '&:hover': { bgcolor: 'rgba(13,18,16,0.7)' },
        }}
      >
        <ChevronLeft size={20} />
      </IconButton>
      <IconButton
        aria-label="Next"
        onClick={() => go(index + 1)}
        sx={{
          position: 'absolute', top: '32%', right: 12, transform: 'translateY(-50%)',
          bgcolor: 'rgba(13,18,16,0.45)', color: '#fff', '&:hover': { bgcolor: 'rgba(13,18,16,0.7)' },
        }}
      >
        <ChevronRight size={20} />
      </IconButton>

      {/* Pagination dots + play/pause */}
      <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton
          aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
          size="small"
          onClick={() => setPlaying((p) => !p)}
          sx={{ bgcolor: 'rgba(13,18,16,0.45)', color: '#fff', '&:hover': { bgcolor: 'rgba(13,18,16,0.7)' } }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </IconButton>
      </Box>
      <Box sx={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 0.75 }}>
        {slides.map((s, i) => (
          <Box
            key={s.src}
            component="button"
            type="button"
            aria-label={`Go to slide ${i + 1}: ${s.title}`}
            onClick={() => go(i)}
            sx={{
              width: i === index ? 22 : 8, height: 8, borderRadius: 4, border: 'none', p: 0, cursor: 'pointer',
              bgcolor: i === index ? DAWN_GOLD : 'rgba(255,255,255,0.5)',
              transition: 'width 0.25s ease, background-color 0.25s ease',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
