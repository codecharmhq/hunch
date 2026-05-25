// Hunch Avatars — Procedural cartoon avatar generation
// Inspired by: Pixar + modern minimalist illustration
// Each agent renders unique avatar from avatarStyle config

(function (global) {
  function buildHair(style, color) {
    switch (style) {
      case 'short-messy':
        return `
          <path d="M30 38 Q35 22 50 20 Q66 18 72 32 Q73 40 70 44 L72 50 Q60 36 50 36 Q40 36 30 50 Q26 42 30 38 Z" fill="${color}"/>
          <path d="M34 28 Q40 22 48 26 L46 30 Q40 27 36 30 Z" fill="${color}" opacity="0.7"/>
        `;
      case 'long-wavy':
        return `
          <path d="M26 44 Q22 30 34 22 Q50 14 66 22 Q78 30 76 48 Q78 64 74 76 L70 70 Q72 56 70 48 Q60 40 50 40 Q40 40 30 48 Q28 60 30 72 L26 76 Q22 60 26 44 Z" fill="${color}"/>
          <path d="M30 50 Q24 55 26 64" stroke="${color}" stroke-width="3" fill="none"/>
          <path d="M70 50 Q76 55 74 64" stroke="${color}" stroke-width="3" fill="none"/>
        `;
      case 'short-neat':
        return `
          <path d="M30 36 Q34 22 50 20 Q66 22 70 36 L70 44 Q60 36 50 36 Q40 36 30 44 Z" fill="${color}"/>
        `;
      case 'ponytail':
        return `
          <path d="M30 38 Q34 22 50 20 Q66 22 70 38 L70 44 Q60 36 50 36 Q40 36 30 44 Z" fill="${color}"/>
          <path d="M68 38 Q80 42 82 56 Q80 68 74 70 Q72 60 70 50 Z" fill="${color}"/>
        `;
      case 'curly-short':
        return `
          <circle cx="36" cy="32" r="8" fill="${color}"/>
          <circle cx="48" cy="26" r="9" fill="${color}"/>
          <circle cx="60" cy="32" r="8" fill="${color}"/>
          <circle cx="68" cy="42" r="6" fill="${color}"/>
          <circle cx="32" cy="42" r="6" fill="${color}"/>
        `;
      default:
        return '';
    }
  }

  function buildAccessory(type, accent) {
    switch (type) {
      case 'glasses':
        return `
          <circle cx="40" cy="54" r="7" fill="none" stroke="#2D3436" stroke-width="2"/>
          <circle cx="60" cy="54" r="7" fill="none" stroke="#2D3436" stroke-width="2"/>
          <line x1="47" y1="54" x2="53" y2="54" stroke="#2D3436" stroke-width="2"/>
        `;
      case 'earrings':
        return `
          <circle cx="28" cy="60" r="2.5" fill="${accent}"/>
          <circle cx="72" cy="60" r="2.5" fill="${accent}"/>
        `;
      case 'monocle':
        return `
          <circle cx="60" cy="54" r="8" fill="none" stroke="#2D3436" stroke-width="2"/>
          <line x1="60" y1="62" x2="60" y2="68" stroke="#2D3436" stroke-width="1.5"/>
        `;
      case 'book':
        return `
          <rect x="62" y="72" width="10" height="8" rx="1" fill="${accent}" opacity="0.85"/>
          <line x1="67" y1="72" x2="67" y2="80" stroke="#fff" stroke-width="0.8"/>
        `;
      case 'leaf':
        return `
          <path d="M70 36 Q78 30 82 36 Q78 42 70 40 Z" fill="${accent}" opacity="0.85"/>
          <path d="M70 38 Q76 36 80 36" stroke="#fff" stroke-width="0.8" fill="none"/>
        `;
      default:
        return '';
    }
  }

  function buildBlush() {
    return `
      <ellipse cx="34" cy="62" rx="4" ry="2.5" fill="#FF8FA3" opacity="0.5"/>
      <ellipse cx="66" cy="62" rx="4" ry="2.5" fill="#FF8FA3" opacity="0.5"/>
    `;
  }

  function buildMouth(mood) {
    // Default gentle smile
    if (mood === 'speaking') {
      return `<ellipse cx="50" cy="68" rx="3.5" ry="2.5" fill="#3A2C2C"/>`;
    }
    return `<path d="M45 67 Q50 71 55 67" stroke="#3A2C2C" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  }

  function buildEyes(color, mood) {
    if (mood === 'thinking') {
      return `
        <path d="M36 54 Q40 52 44 54" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M56 54 Q60 52 64 54" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
    }
    return `
      <circle cx="40" cy="55" r="3" fill="${color}"/>
      <circle cx="60" cy="55" r="3" fill="${color}"/>
      <circle cx="41" cy="54" r="0.9" fill="#fff"/>
      <circle cx="61" cy="54" r="0.9" fill="#fff"/>
    `;
  }

  /**
   * Generate avatar SVG string
   * @param {object} agent  with avatarStyle / color / bgGradient
   * @param {object} [opts] mood: 'idle'|'speaking'|'thinking'
   * @returns {string} SVG
   */
  function renderAvatar(agent, opts) {
    opts = opts || {};
    const s = agent.avatarStyle || {};
    const grad = agent.bgGradient || ['#fff', '#eee'];
    const gradId = `g-${agent.id || 'x'}-${Math.random().toString(36).slice(2, 7)}`;
    const mood = opts.mood || 'idle';

    return `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="avatar-svg">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${grad[0]}"/>
      <stop offset="100%" stop-color="${grad[1]}"/>
    </linearGradient>
    <filter id="${gradId}-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
      <feOffset dx="0" dy="1" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- bg circle -->
  <circle cx="50" cy="50" r="48" fill="url(#${gradId})"/>

  <!-- neck -->
  <rect x="44" y="78" width="12" height="14" rx="3" fill="${s.skin || '#FFD8B5'}"/>

  <!-- face (chibi round face) -->
  <ellipse cx="50" cy="56" rx="22" ry="24" fill="${s.skin || '#FFD8B5'}" filter="url(#${gradId}-shadow)"/>

  <!-- hair -->
  ${buildHair(s.hairStyle, s.hair)}

  <!-- eyes -->
  ${buildEyes(s.eyes || '#2D3436', mood)}

  <!-- blush -->
  ${buildBlush()}

  <!-- mouth -->
  ${buildMouth(mood)}

  <!-- accessory -->
  ${buildAccessory(s.accessory, agent.accent || agent.color)}
</svg>`;
  }

  global.HunchAvatar = { renderAvatar };
})(typeof window !== 'undefined' ? window : global);
