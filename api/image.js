const axios = require('axios');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { prompt, size = '1024x1024', quality = 'standard' } = req.body;

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const response = await axios.post(
            'https://api.openai.com/v1/images/generations',
            {
                model: 'dall-e-3',
                prompt,
                size,
                quality,
                n: 1
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: parseInt(process.env.WIDGET_TIMEOUT_MS) || 30000
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Image API error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to generate image',
            details: error.response?.data?.error?.message || error.message
        });
    }
} 