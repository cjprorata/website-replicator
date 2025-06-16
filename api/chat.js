const axios = require('axios');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { messages, model = 'gpt-4o-mini' } = req.body;

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model,
                messages,
                max_tokens: 1000,
                temperature: 0.7
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
        console.error('Chat API error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to process chat request',
            details: error.response?.data?.error?.message || error.message
        });
    }
} 