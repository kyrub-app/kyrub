import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Play, Eye } from 'lucide-react';

interface MediaCarouselProps {
  mediaUrls: string[];
}

export function MediaCarousel({ mediaUrls }: MediaCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!mediaUrls || mediaUrls.length === 0) return null;

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex + 1) % mediaUrls.length);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex - 1 + mediaUrls.length) % mediaUrls.length);
  };

  const isVideo = (url: string) => {
    return (
      url.endsWith('.mp4') ||
      url.endsWith('.webm') ||
      url.startsWith('data:video/') ||
      url.includes('video') ||
      url.includes('stream')
    );
  };

  return (
    <div className="relative group w-full h-56 rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/80">
      {/* Slides */}
      <div className="relative w-full h-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full flex items-center justify-center"
          >
            {isVideo(mediaUrls[currentIndex]) ? (
              <div className="relative w-full h-full">
                <video
                  src={mediaUrls[currentIndex]}
                  className="w-full h-full object-cover"
                  controls
                  playsInline
                  muted
                />
                <span className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-[8px] font-mono text-orange-400 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  ▶ Vídeo BaaS
                </span>
              </div>
            ) : (
              <img
                src={mediaUrls[currentIndex]}
                alt={`Media slide ${currentIndex + 1}`}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Control Overlays */}
      {mediaUrls.length > 1 && (
        <>
          {/* Navigation Arrows */}
          <button
            onClick={handlePrev}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 bg-slate-950/80 backdrop-blur-sm hover:bg-slate-900 border border-slate-800 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
            aria-label="Previous Slide"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-slate-950/80 backdrop-blur-sm hover:bg-slate-900 border border-slate-800 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
            aria-label="Next Slide"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Pagination Indicators (dots) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 bg-black/50 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
            {mediaUrls.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  index === currentIndex
                    ? 'bg-orange-500 scale-125 w-2.5'
                    : 'bg-slate-500 hover:bg-slate-400'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}

      {/* Slide Index Badge */}
      <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 text-[8px] font-mono text-slate-400 font-bold px-2.5 py-0.5 rounded-full">
        {currentIndex + 1} / {mediaUrls.length}
      </div>
    </div>
  );
}
