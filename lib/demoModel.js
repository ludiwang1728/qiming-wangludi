// 演示模型：不调用任何真实接口，用模板拼出 3 组名字，按 SSE 的分片节奏吐出来
// 目的只有一个——没有密钥时也能把「流式输出 → 落库 → 历史」整条链路演示通

const MALE = [
  ['砚舟', 'yàn zhōu', '砚为文房之宝，取读书治学之意；舟行万里，寓意从容向前、胸有丘壑。', '书卷气，静水流深'],
  ['承煦', 'chéng xù', '承者担当，煦为春日暖阳，寓意温和而有担待，能把暖意带给身边人。', '温润大气，亲和'],
  ['知野', 'zhī yě', '知者明理，野取旷达之意，寓意通事理又不被俗见所困，心怀开阔。', '现代简洁，清朗'],
]

const FEMALE = [
  ['疏蘅', 'shū héng', '疏为通透舒展，蘅是香草名，出处近《楚辞》，寓意清雅自持、性情温良。', '国风典雅，含蓄'],
  ['今宜', 'jīn yí', '今为当下，宜取合宜、安适，寓意活得舒展适时，不慌不忙地把日子过好。', '现代简约，明亮'],
  ['lǎng 琅', 'lǎng láng', '琅为美玉之称，音清亮如玉相击，寓意质地纯粹、才情外显。', '大气，带光'],
]

const NEUTRAL = [
  ['清和', 'qīng hé', '清者澄澈，和者协调，取四时清明、人事和顺之意，平正而不寡淡。', '平和，耐读'],
  ['予安', 'yǔ ān', '予是给予，安是安稳，寓意能把安定感带给别人，也守得住自己的节奏。', '温润，松弛'],
  ['行简', 'xíng jiǎn', '行是践行，简为不繁，取“居敬行简”之意，寓意做事有章法又不拖沓。', '干净，利落'],
]

const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹柏水窦章苏潘葛范彭鲁韦马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹'.split('')

function pickSurname(requirement) {
  const explicit = requirement.match(/姓\s*([\u4e00-\u9fa5]{1,2})/)
  if (explicit) return explicit[1]
  // 需求里直接出现“李姓”“姓李”之外，再兜底扫一遍常见姓氏
  for (const ch of SURNAMES) {
    if (requirement.includes(ch)) return ch
  }
  return ''
}

function pickPool(requirement) {
  if (/英文名|英文|english/i.test(requirement)) return NEUTRAL
  if (/女孩|女生|女|闺女|千金/.test(requirement)) return FEMALE
  if (/男孩|男生|男|小子|公子/.test(requirement)) return MALE
  return NEUTRAL
}

/** 生成演示文本 */
export function buildDemoText(requirement) {
  const surname = pickSurname(requirement)
  const pool = pickPool(requirement)
  const prefix = surname || '（可替换为你家姓氏）'
  const cn = ['一', '二', '三']

  const blocks = pool.map(([name, pinyin, meaning, vibe], i) => {
    const full = prefix + name
    return [
      `【方案${cn[i]}】${full}`,
      `读音：${surname ? surnamePinyin(surname) + ' ' : ''}${pinyin}`,
      `寓意：${meaning}`,
      `气质：${vibe}`,
    ].join('\n')
  })

  return [
    blocks[0],
    '',
    blocks[1],
    '',
    blocks[2],
    '',
    '—— 本条由「演示模型」在本地模拟生成，用于验证流式输出与历史留存；',
    '   配好任一大模型密钥后，把下拉框切到豆包 / DeepSeek / 千问 / Kimi 即可得到真实结果。',
  ].join('\n')
}

/** 少量姓氏的拼音，够演示用 */
function surnamePinyin(surname) {
  const map = {
    李: 'lǐ', 王: 'wáng', 张: 'zhāng', 刘: 'liú', 陈: 'chén', 杨: 'yáng', 赵: 'zhào', 黄: 'huáng',
    周: 'zhōu', 吴: 'wú', 徐: 'xú', 孙: 'sūn', 马: 'mǎ', 朱: 'zhū', 胡: 'hú', 郭: 'guō', 林: 'lín',
    何: 'hé', 高: 'gāo', 罗: 'luó', 郑: 'zhèng', 梁: 'liáng', 谢: 'xiè', 宋: 'sòng', 唐: 'táng',
    许: 'xǔ', 韩: 'hán', 冯: 'féng', 邓: 'dèng', 曹: 'cáo', 彭: 'péng', 曾: 'zēng', 田: 'tián',
  }
  return map[surname] || surname
}

/**
 * 按节奏切片吐字：每 6 个字一片，模拟真实模型的打字速度
 * @param {string} text
 * @param {(chunk:string)=>void} onChunk
 */
export async function streamDemoText(text, onChunk, shouldStop = () => false) {
  const step = 6
  for (let i = 0; i < text.length; i += step) {
    if (shouldStop()) return false
    onChunk(text.slice(i, i + step))
    await new Promise((r) => setTimeout(r, 45))
  }
  return true
}
