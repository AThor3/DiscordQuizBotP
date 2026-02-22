const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');


const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Slash command registration ──────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('donate')
      .setDescription('Support the bot development ❤️'),
    new SlashCommandBuilder()
      .setName('quiz')
      .setDescription('Generate quiz questions with hidden answers on any topic')
      .addStringOption(opt =>
        opt.setName('topic')
          .setDescription('The topic you want to be quizzed on')
          .setRequired(true))
      .addIntegerOption(opt =>
        opt.setName('questions')
          .setDescription('Number of questions (1-10, default 5)')
          .setMinValue(1)
          .setMaxValue(10))
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Slash commands registered!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ── Generate questions (mirrors Perchance prompt exactly) ───────────────────
async function generateQuestions(topic, numQuestions) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `### Instructions
- You are to ask questions about the following topic/details:
USER: "${topic}"
- Make sure your questions will create more questions to expand, flesh out, know more of the topic.
- Be sure to be concise, open, objective, logical, but sometimes profound and thought provoking.
### Reminders
- Reply only with questions.
- Do not repeat what is already on the given details.
- You must respond in a numbered list.
- You must respond with at most ${numQuestions} question(s).`,
      },
    ],
  });

  const text = response.choices[0].message.content.trim();
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => line.replace(/^\d+\.\s*/i, '').trim())
    .filter(q => q.length > 0)
    .slice(0, numQuestions);
}

// ── Generate answer for a single question (mirrors Perchance prompt exactly) ─
async function generateAnswer(topic, question) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `### Instructions
- Based on the following context:
USER: "${topic}"
- You are to answer the following question.
USER: "${question}"
- Be sure to be concise, open, objective, logical, and relevant to the context given.
### Reminders
- Respond only with short/concise answers.
- Do not repeat what is already on the given details.
- At most 30 words per answer.`,
      },
    ],
  });

  return response.choices[0].message.content.trim();
}

// ── Discord events ──────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'donate') {
    const donateEmbed = new EmbedBuilder()
      .setTitle('☕ Support the Bot')
      .setDescription('Enjoying the bot? Consider buying me a coffee!\n\n[ko-fi.com/athor](https://ko-fi.com/athor)')
      .setColor(0xFF5E5B);
    return interaction.reply({ embeds: [donateEmbed] });
  }

  if (interaction.commandName !== 'quiz') return;

  const topic = interaction.options.getString('topic');
  const numQuestions = interaction.options.getInteger('questions') || 5;

  await interaction.deferReply();

  try {
    // Generate all questions first
    console.log(`Generating ${numQuestions} questions for: "${topic}"`);
    const questions = await generateQuestions(topic, numQuestions);

    if (questions.length === 0) {
      return interaction.editReply('Could not generate questions. Please try a different topic.');
    }

    // Intro embed
    const introEmbed = new EmbedBuilder()
      .setTitle(`📚 Quiz: ${topic}`)
      .setDescription(`Here are **${questions.length}** questions! Click the spoilers to reveal each answer.`)
      .setColor(0x5865F2)
      .setFooter({ text: 'Generated via Question This' });
    await interaction.editReply({ embeds: [introEmbed] });

    // Generate answer for each question and post as individual embeds
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`Generating answer for Q${i + 1}...`);
      const answer = await generateAnswer(topic, question);

      const qaEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .addFields(
          { name: `❓ Question ${i + 1}`, value: question },
          { name: '💡 Answer', value: `||${answer}||` }
        );
      await interaction.followUp({ embeds: [qaEmbed] });
    }

  } catch (err) {
    console.error('Error generating quiz:', err);
    const errEmbed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription('Something went wrong while generating the quiz. Please try again.')
      .setColor(0xED4245);
    await interaction.editReply({ embeds: [errEmbed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
