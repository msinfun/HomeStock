const { GoogleGenAI } = require('@google/genai');
async function test() {
  const ai = new GoogleGenAI({ apiKey: 'dummy' });
  try {
    console.log('Testing gemini-3-flash-preview...');
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000));
    await Promise.race([
      ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'hello' }),
      timeout
    ]);
  } catch (e) {
    console.log('Result:', e.message);
  }
}
test();
