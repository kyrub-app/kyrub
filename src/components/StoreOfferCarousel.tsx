import React, { useState, useEffect } from 'react';

interface StoreOfferCarouselProps {
  images: string[];
}

export const StoreOfferCarousel: React.FC<StoreOfferCarouselProps> = ({ images }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!images || images.length <= 1) return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [images]);

  if (!images || images.length === 0) return null;

  return (
    <div className="absolute inset-0 w-full h-full select-none pointer-events-none">
      {images.map((img, i) => (
        <img
          key={img}
          src={img}
          alt="Oferta Vitrine"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            i === index ? 'opacity-35' : 'opacity-0'
          }`}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/60 to-slate-950/85" />
    </div>
  );
};
