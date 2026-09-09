import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #06080d 0%, #0d1118 100%)',
          borderRadius: 96,
        }}
      >
        <div
          style={{
            width: 320,
            height: 320,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #2563eb, #14b8a6)',
            borderRadius: 80,
            boxShadow: '0 24px 80px rgba(37, 99, 235, 0.45)',
          }}
        >
          <svg
            width="200"
            height="200"
            viewBox="0 0 24 24"
            fill="none"
            style={{ display: 'block' }}
          >
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ),
    size
  );
}
