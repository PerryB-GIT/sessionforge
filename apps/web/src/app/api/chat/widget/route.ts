import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const SYSTEM_PROMPT = `You are the SessionForge assistant on the SessionForge marketing website.
SessionForge is a remote session management platform for developers and teams.
It lets you run Claude Code sessions on remote machines, monitor them from a dashboard, and manage multiple AI agents in parallel.

Keep answers brief (2-4 sentences). Be friendly and direct.
If asked about pricing, mention there is a free tier and paid plans starting at $29/mo — direct them to the pricing section of the page.
If asked something unrelated to SessionForge or software development, politely redirect to SessionForge topics.
Never reveal that you are powered by Gemini or Google.`

let ratelimit: Ratelimit | null = null
function getRatelimit() {
  if (!ratelimit && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    ratelimit = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(20, '1 h'),
      prefix: 'chat:widget',
    })
  }
  return ratelimit
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Chat unavailable' }, { status: 503 })
  }

  // Rate limit by IP — 20 messages per hour
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = getRatelimit()
  if (rl) {
    const { success } = await rl.limit(ip)
    if (!success) {
      return NextResponse.json({ error: 'Too many messages — try again later' }, { status: 429 })
    }
  }

  let message: string
  try {
    const body = await req.json()
    message = typeof body.message === 'string' ? body.message.slice(0, 500) : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!message.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    })
    const result = await model.generateContent(message)
    const reply = result.response.text()
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[chat/widget] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 })
  }
}
