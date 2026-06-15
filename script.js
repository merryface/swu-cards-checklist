'use strict';

const API_BASE_URL = 'https://api.swu-db.com';
const CORS_PROXY_URL = 'https://corsproxy.io/?';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Application initialization
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('checklistForm');
  const setSelect = document.getElementById('setSelect');
  const circlesSelect = document.getElementById('circlesSelect');
  const checklistDiv = document.getElementById('checklist');
  const printBtn = document.getElementById('printBtn');

  // Preload badge image for reliable printing
  const badgeImg = new Image();
  badgeImg.src = 'badge.png';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedSet = setSelect.value;
    const numberOfCircles = parseInt(circlesSelect.value, 10);

    if (!selectedSet) {
      alert('Please select a set');
      return;
    }

    await generateChecklist(selectedSet, numberOfCircles);
  });

  async function generateChecklist(set, circles) {
    checklistDiv.innerHTML = '<p>Loading cards...</p>';
    printBtn.disabled = true;
    
    // Update document title for PDF filename
    document.title = `${set.toUpperCase()} Checklist`;
    
    // Show spinner
    const spinner = printBtn.querySelector('.spinner');
    if (spinner) spinner.style.display = 'inline-block';
    
    try {
      const cards = await fetchCards(set);
      displayCards(cards, circles, set);
      
      // Enable print button after 3 seconds to allow badge image to load
      setTimeout(() => {
        printBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
      }, 3000);
    } catch (error) {
      checklistDiv.innerHTML = `<p style="color: #ff4500;">Error: ${error.message}</p>`;
      printBtn.disabled = true;
      if (spinner) spinner.style.display = 'none';
    }
  }

  function getCachedData(setCode) {
    const cacheKey = `swu_set_${setCode.toLowerCase()}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (!cached) return null;
    
    try {
      const data = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is still valid (less than 1 week old)
      if (now - data.timestamp < CACHE_DURATION) {
        console.log(`Using cached data for ${setCode}`);
        return data.cards;
      } else {
        console.log(`Cache expired for ${setCode}`);
        localStorage.removeItem(cacheKey);
        return null;
      }
    } catch (e) {
      console.error('Error reading cache:', e);
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  function setCachedData(setCode, cards) {
    const cacheKey = `swu_set_${setCode.toLowerCase()}`;
    const data = {
      timestamp: Date.now(),
      cards: cards
    };
    
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
      console.log(`Cached ${cards.length} cards for ${setCode}`);
    } catch (e) {
      console.error('Error saving to cache:', e);
    }
  }

  async function fetchCards(setCode) {
    // Check cache first
    const cachedCards = getCachedData(setCode);
    if (cachedCards) {
      return cachedCards;
    }

    // Fetch from API - always use CORS proxy since API doesn't have CORS headers
    const apiUrl = `${API_BASE_URL}/cards/${setCode.toLowerCase()}`;
    const fetchUrl = `${CORS_PROXY_URL}${encodeURIComponent(apiUrl)}`;
    
    console.log('Fetching from:', fetchUrl);
    
    // Use AbortController for request timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      const response = await fetch(fetchUrl, { 
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const cards = parseJSON(data, setCode);
      console.log(`Fetched ${cards.length} cards from ${setCode}`);
      
      // Cache the results
      setCachedData(setCode, cards);
      
      return cards;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - please try again');
      }
      
      throw new Error(`Failed to fetch cards: ${error.message}`);
    }
  }

  function parseJSON(data, expectedSet) {
    const cardsArray = Array.isArray(data) ? data : (data.data || data.cards || []);
    
    if (!Array.isArray(cardsArray) || cardsArray.length === 0) {
      console.error('No cards array found in response:', data);
      return [];
    }

    const cards = [];
    let skippedVariant = 0;
    let skippedMissingData = 0;

    for (const card of cardsArray) {
      // Only include Normal variant cards
      const variantType = card.VariantType || card.variantType || card.varianttype || '';
      if (variantType !== 'Normal') {
        skippedVariant++;
        continue; // Skip variant cards (foil, showcase, hyperspace, etc.)
      }

      // Extract card data
      const number = extractCardNumber(card.Number || card.number || card.SetNumber || card.setnumber);
      const name = card.Name || card.name;
      const type = card.Type || card.type || '';
      const aspects = card.Aspects || card.aspects || '';

      if (number && name) {
        cards.push({ 
          number, 
          name, 
          type: type.trim(),
          aspects: parseAspects(aspects)
        });
      } else {
        skippedMissingData++;
        console.log(`Skipped card - missing data: number=${number}, name=${name}`, card);
      }
    }

    console.log(`Parse summary: ${cards.length} cards included, ${skippedVariant} variants, ${skippedMissingData} missing data`);
    return cards;
  }

  function parseAspects(aspectString) {
    if (!aspectString) return [];
    
    // If already an array, return it
    if (Array.isArray(aspectString)) {
      return aspectString.filter(aspect => aspect && aspect.length > 0);
    }
    
    // Handle string format like "['Vigilance', 'Villainy']" or "Vigilance"
    if (typeof aspectString === 'string') {
      const cleaned = aspectString
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .replace(/'/g, '')
        .replace(/"/g, '')
        .trim();
      
      // Only split by comma if there's actually a comma present
      if (cleaned.includes(',')) {
        return cleaned
          .split(',')
          .map(aspect => aspect.trim())
          .filter(aspect => aspect.length > 0);
      } else {
        // Single aspect, return as array with one element
        return cleaned.length > 0 ? [cleaned] : [];
      }
    }
    
    return [];
  }

  // Simplified grouping per user preference. LAW gets a special Multi-Aspect rule.
  function groupCards(cards, setCode) {
    const normalizedSetCode = setCode ? setCode.toUpperCase() : '';
    const isLaw = normalizedSetCode === 'LAW';

    const groups = {
      'Leaders': [],
      'Bases': [],
      'Multi-Aspect': [],
      'Vigilance': [],
      'Command': [],
      'Aggression': [],
      'Cunning': [],
      'Villainy': [],
      'Heroism': [],
      'Other': []
    };

    for (const card of cards) {
      const type = (card.type || '').toLowerCase();

      if (type === 'leader') {
        groups['Leaders'].push(card);
        continue;
      }

      if (type === 'base') {
        groups['Bases'].push(card);
        continue;
      }

      const aspects = Array.isArray(card.aspects) ? card.aspects : [];

      // LAW-specific Multi-Aspect: more than one non-Heroism, non-Villainy aspects
      if (isLaw) {
        const nonHV = aspects.filter(a => a !== 'Heroism' && a !== 'Villainy');
        if (nonHV.length > 1) {
          groups['Multi-Aspect'].push(card);
          continue;
        }
      }

      if (aspects.length > 0) {
        const primary = aspects[0];
        if (groups[primary]) {
          groups[primary].push(card);
        } else {
          groups['Other'].push(card);
        }
      } else {
        groups['Other'].push(card);
      }
    }

    // Return groups in the user's preferred order
    const ordered = [];
    const groupOrder = ['Leaders', 'Bases', 'Multi-Aspect', 'Vigilance', 'Command', 'Aggression', 'Cunning', 'Villainy', 'Heroism', 'Other'];

    for (const name of groupOrder) {
      if (groups[name] && groups[name].length > 0) {
        ordered.push({ name, cards: groups[name].sort((a, b) => a.number - b.number) });
      }
    }

    return ordered;
  }

  function parseCSVLine(line) {
    const result = [];
    let currentField = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        result.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }

    result.push(currentField);
    return result;
  }

  function extractCardNumber(value) {
    if (!value) return null;
    
    const str = String(value).trim();
    const match = str.match(/(\d{1,3})\s*$/);
    
    return match ? parseInt(match[1], 10) : null;
  }

  function displayCards(cards, circles, setCode) {
    if (cards.length === 0) {
      checklistDiv.innerHTML = '<p>No cards found.</p>';
      return;
    }

    const ASPECT_DISPLAY = {
      'Leaders': { regular: 'Leaders', aurebesh: 'Leaders' },
      'Bases': { regular: 'Bases', aurebesh: 'Bases' },
      'Vigilance': { regular: 'Blue', aurebesh: 'Vigilance' },
      'Command': { regular: 'Green', aurebesh: 'Command' },
      'Aggression': { regular: 'Red', aurebesh: 'Aggression' },
      'Cunning': { regular: 'Yellow', aurebesh: 'Cunning' },
      'Villainy': { regular: 'Black', aurebesh: 'Villainy' },
      'Heroism': { regular: 'White', aurebesh: 'Heroism' },
      'Multi-Aspect': { regular: 'Multi-Aspect', aurebesh: 'Multi-Aspect' },
      'Other': { regular: 'Grey', aurebesh: 'Other' }
    };

    const groupedCards = groupCards(cards, setCode);
    let html = '';
    
    for (const group of groupedCards) {
      const display = ASPECT_DISPLAY[group.name] || {
        regular: group.name
          .split(' / ')
          .map((aspect) => ASPECT_DISPLAY[aspect]?.regular || aspect)
          .join(' / '),
        aurebesh: group.name
      };
      
      html += `
        <div class="card-group">
          <h2 class="group-header">
            <span class="header-regular">${display.regular}</span>
            <span class="header-separator"> - </span>
            <span class="header-aurebesh">${display.aurebesh}</span>
          </h2>
          <div class="card-list">
      `;
      
      for (const card of group.cards) {
        const paddedNumber = String(card.number).padStart(3, '0');
        html += `
          <div class="card-item">
            <span class="card-number">${paddedNumber}</span>
            <span class="card-name">${card.name}</span>
            <div class="card-circles">
        `;
        
        for (let i = 0; i < circles; i++) {
          html += `<span class="circle"></span>`;
        }
        
        html += `
            </div>
          </div>
        `;
      }
      
      html += `
          </div>
        </div>
      `;
    }
    
    // Add set badge with full name
    const SET_NAMES = {
      'SOR': 'Spark of Rebellion',
      'SHD': 'Shadows of the Galaxy',
      'TWI': 'Twilight of the Republic',
      'JTL': 'Jump to Lightspeed',
      'LOF': 'Legends of the Force',
      'SEC': 'Secrets of Power',
      'LAW': 'Law and Order'
    };
    
    const setCodeUpper = setCode.toUpperCase();
    const setName = SET_NAMES[setCodeUpper] || 'Unknown Set';
    
    html += `
      <div class="set-badge">
        <img src="badge.png" alt="Set Badge" class="badge-image">
        <div class="badge-content">
          <div class="badge-code-aurebesh">${setCodeUpper}</div>
          <div class="badge-text-group">
            <div class="badge-code">${setCodeUpper}</div>
            <div class="badge-name">${setName}</div>
          </div>
        </div>
      </div>
    `;
    
    checklistDiv.innerHTML = html;
  }
});
