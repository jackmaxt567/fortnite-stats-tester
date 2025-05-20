import express from 'express';
import bodyParser from 'body-parser';
import { OsirionClient } from '@osirion/api';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const osirion = new OsirionClient('e45a8d05-e233-4e52-9c4a-f731bbbe1bab');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

async function getRecentEvents(epicName) {
  const url = `https://fortnitetracker.com/profile/all/${encodeURIComponent(epicName)}/events`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');
  await page.goto(url, { waitUntil: 'networkidle2' });

  try {
    await page.waitForSelector('a[href*="window="]', { timeout: 20000 });
    const eventIds = await page.$$eval('a[href*="window="]', (links) => {
      const seen = new Set();
      const events = [];
      for (const link of links) {
        const href = link.getAttribute('href');
        const match = href.match(/window=([^&]+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          events.push(match[1]);
        }
      }
      return events.slice(0, 10);
    });
    await browser.close();
    return eventIds;
  } catch (err) {
    await browser.close();
    return [];
  }
}

async function getEpicIdFromProfilePage(epicName) {
  const url = `https://fortnitetracker.com/profile/all/${encodeURIComponent(epicName)}/events`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');
  await page.goto(url, { waitUntil: 'networkidle2' });

  try {
    const scripts = await page.$$eval('script', (elements) =>
      elements.map((el) => el.textContent)
    );
    for (const script of scripts) {
      const match = script.match(/platformUserId\s*:\s*['"]([a-f0-9\-]{36})['"]/i);
      if (match) {
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/select-event', async (req, res) => {
  const { username } = req.body;
  const events = await getRecentEvents(username);
  if (!events.length) return res.render('error', { message: 'No events found.' });
  res.render('select-event', { username, events });
});

app.post('/stats', async (req, res) => {
  const { username, selectedEvent } = req.body;

  if (!selectedEvent) {
    return res.render('error', { message: 'EventWindowId is required' });
  }

  const epicId = await getEpicIdFromProfilePage(username);
  if (!epicId) return res.render('error', { message: 'Could not extract Epic ID.' });

  try {
    const stats = await osirion.getTournamentPlayerStats({
      eventWindowId: selectedEvent,
      epicAccountIds: [epicId],
    });

    const playerStats = stats.find(
      (s) => s.epicUsername.toLowerCase() === username.toLowerCase()
    );

    if (!playerStats) {
      return res.render('error', { message: 'Stats not found for this user.' });
    }

    // Format numbers cleanly
    const formattedStats = {};
    const fields = [
      'matchesPlayed', 'eliminations', 'assists', 'damageToPlayers', 'damageTakenFromPlayers',
      'avgPlacement', 'damageRatio', 'shots', 'headshots', 'hitsToPlayers',
      'timeAlive', 'timeInStorm', 'stormDamage', 'fallDamage',
      'woodFarmed', 'stoneFarmed', 'metalFarmed',
      'woodCollected', 'stoneCollected', 'metalCollected',
      'woodBuildsPlaced', 'stoneBuildsPlaced', 'metalBuildsPlaced'
    ];

    for (const key of fields) {
      if (playerStats[key] !== undefined) {
        const value = playerStats[key];
        formattedStats[key] = Number.isInteger(value) ? value : value.toFixed(2);
      }
    }
console.log('Submitted:', req.body);

    res.render('stats', {
      stats: formattedStats,
      event: selectedEvent,
      username: username,
    });
  } catch (err) {
    res.render('error', { message: err.message });
  }
});



app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
