// Debate Engine — Dynamic Multi-Agent Debate Engine
// Supports customizable agent count (1-10), each agent can use different LLM

const { chatStream } = require('./llm');
const { buildDebateAgents, buildDebateFlow, ROLE_TEMPLATES } = require('./agents');
const { resolveAgentConfig } = require('./keystore');

/**
 * Run a debate
 * @param {object} opts
 * @param {string} opts.topic - Topic / question
 * @param {Array}  opts.agents - Custom agent list [{id, name, role, color, provider?, model?}]
 * @param {string} [opts.provider] - Global provider
 * @param {object} [opts.customConfig] - Global customConfig
 * @param {string} [opts.model] - Global model
 * @param {(event:object)=>void} opts.emit - SSE event emitter
 * @returns {Promise<{transcript: Array, summary: string}>}
 */
async function runDebate({ topic, agents, provider, customConfig, model, emit }) {
  // Build debate agents and flow
  const debateAgents = buildDebateAgents(agents);
  const flow = buildDebateFlow(debateAgents);

  // Agent index
  const agentMap = {};
  debateAgents.forEach(a => agentMap[a.id] = a);

  emit({ type: 'debate_start', topic, flow, agents: publicAgentInfo(debateAgents) });

  const transcript = [];

  for (let i = 0; i < flow.length; i++) {
    const agentId = flow[i];
    const agent = agentMap[agentId];
    if (!agent) continue;

    const prevAgent = i > 0 ? agentMap[flow[i - 1]] : null;
    const agentRole = Array.isArray(agents) ? agents.find(a => a.id === agentId)?.role : null;
    const isFinal = (i === flow.length - 1) && ROLE_TEMPLATES[agentRole]?.name === 'Synthesizer';

    // Resolve agent-specific LLM config
    const agentCfg = resolveAgentConfig(agentId);
    let aCustomConfig = customConfig;
    let aModel = model;
    let aProvider = provider;

    if (agentCfg) {
      aCustomConfig = { baseUrl: agentCfg.baseUrl, apiKey: agentCfg.apiKey, model: agentCfg.model };
      aModel = agentCfg.model;
      aProvider = undefined;
    }

    // Check for client-side config override
    const clientAgent = Array.isArray(agents) ? agents.find(a => a.id === agentId) : null;
    if (clientAgent?.provider) {
      aProvider = clientAgent.provider;
    }
    if (clientAgent?.model) {
      aModel = clientAgent.model;
    }

    emit({
      type: 'turn_start',
      turnIndex: i,
      agentId,
      agentName: agent.name,
      agentRole: agent.role,
      agentColor: agent.color,
      agentEmoji: agent.emoji,
      isFinal,
      replyingTo: prevAgent ? { name: prevAgent.name, content: transcript[i - 1]?.content?.slice(0, 100) || '' } : null,
      model: aModel || aCustomConfig?.model || '(default)'
    });

    const messages = buildMessages(agent, topic, transcript, isFinal, prevAgent);
    let fullText = '';

    try {
      fullText = await chatStream({
        provider: aProvider,
        customConfig: aCustomConfig,
        model: aModel,
        messages,
        onToken: (token) => {
          emit({ type: 'token', agentId, turnIndex: i, token });
        }
      });
    } catch (e) {
      const errMsg = `[Error: ${e.message}]`;
      emit({ type: 'token', agentId, turnIndex: i, token: errMsg });
      fullText = errMsg;
    }

    // Extract position from model output
    let position = 'neutral';
    const lower = fullText.toLowerCase();
    if (/\b(agree|support|right|valid|spot on|exactly)\b/.test(lower)) position = 'agree';
    else if (/\b(disagree|oppose|wrong|incorrect|reject|no |not right)\b/.test(lower)) position = 'disagree';
    else if (/\b(qualify|conditional|depends|but |however|maybe|perhaps)\b/.test(lower)) position = 'neutral';

    transcript.push({
      turnIndex: i,
      agentId,
      agentName: agent.name,
      agentRole: agent.role,
      content: fullText,
      position,
      isFinal,
      model: aModel || aCustomConfig?.model || ''
    });

    // Position stats
    const agreeCount = transcript.filter(t => t.position === 'agree').length;
    const disagreeCount = transcript.filter(t => t.position === 'disagree').length;
    const neutralCount = transcript.filter(t => t.position === 'neutral').length;
    emit({
      type: 'turn_end',
      turnIndex: i,
      agentId,
      agentName: agent.name,
      agentRole: agent.role,
      agentColor: agent.color,
      agentEmoji: agent.emoji,
      content: fullText,
      position,
      isFinal,
      voteBar: { agree: agreeCount, disagree: disagreeCount, neutral: neutralCount, total: debateAgents.length }
    });

    await sleep(300);
  }

  // Synthesizer analyzes minority opinions
  const nonFinalTurns = transcript.filter(t => !t.isFinal);
  const agreeTurns = nonFinalTurns.filter(t => t.position === 'agree');
  const disagreeTurns = nonFinalTurns.filter(t => t.position === 'disagree');
  const neutralTurns = nonFinalTurns.filter(t => t.position === 'neutral');

  const minorityTurns = [...disagreeTurns];
  if (neutralTurns.length > 0 && neutralTurns.length <= 1) minorityTurns.push(...neutralTurns);
  if (agreeTurns.length > 0 && agreeTurns.length === 1) minorityTurns.push(agreeTurns[0]);

  const finalTurn = transcript.find(t => t.isFinal) || transcript[transcript.length - 1];
  const summary = finalTurn ? finalTurn.content : '';

  if (minorityTurns.length > 0) {
    emit({
      type: 'minority',
      minorityTurns: minorityTurns.map(t => ({
        agentName: t.agentName,
        agentRole: t.agentRole,
        position: t.position,
        content: t.content
      }))
    });
  }

  // Frontend listens for 'echo' event to display final synthesis
  emit({ type: 'echo', content: summary });
  return { transcript, summary };
}

function buildMessages(agent, topic, transcript, isFinal, prevAgent) {
  const messages = [{ role: 'system', content: agent.systemPrompt }];

  const historyText = transcript.length === 0
    ? '(You are the first speaker.)'
    : transcript.map(t => `### ${t.agentName} (${t.agentRole})\n${t.content}`).join('\n\n');

  let userPrompt = '';
  if (isFinal) {
    userPrompt = `## Debate topic\n${topic}\n\n## Full debate transcript\n${historyText}\n\n## Your turn\nProduce the final synthesis as instructed in your system prompt.`;
  } else if (prevAgent && transcript.length > 0) {
    const prevContent = transcript[transcript.length - 1]?.content || '';
    userPrompt = `## Debate topic\n${topic}\n\n## Previous agent said:\n${prevContent.slice(0, 300)}\n\n## Debate so far\n${historyText}\n\n## Your turn (as ${agent.name}, ${agent.role})\nRespond to the previous agent's points. Show agreement OR disagreement — be explicit. Challenge weak claims. Keep it 100-200 words.`;
  } else {
    userPrompt = `## Debate topic\n${topic}\n\n## Debate so far\n${historyText}\n\n## Your turn (as ${agent.name}, ${agent.role})\nRespond now. Keep it short and substantive.`;
  }

  messages.push({ role: 'user', content: userPrompt });
  return messages;
}

function publicAgentInfo(debateAgents) {
  const out = {};
  for (const a of debateAgents) {
    const config = resolveAgentConfig(a.id);
    out[a.id] = {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      emoji: a.emoji,
      currentModel: config?.model || '(default)',
      currentProvider: config?.label || ''
    };
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runDebate, publicAgentInfo };
