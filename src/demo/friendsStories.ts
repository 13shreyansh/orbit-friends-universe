export type FriendsStory = {
  title: string
  relationship: string
  description: string
  photos: { url: string; caption: string }[]
}

type Friend = 'ross' | 'rachel' | 'monica' | 'chandler' | 'joey' | 'phoebe'
const photo = (file: string, caption: string) => ({ url: `/orbit-friends-universe/friends/${file}`, caption })
const pairPhoto = (file: string, caption: string) => ({ url: `/orbit-friends-universe/friends-pairs/${file}`, caption })

// Curated relationship chapters, not image recognition. Captions identify the
// actual frame; an episode-context image need not show both people in the pair.
const stories: Record<string, FriendsStory> = {
  'rachel|ross': {
    title: 'Ross & Rachel',
    relationship: 'Love and second chances',
    description: 'A prom video, a planetarium date and the familiar circle around them. Ross and Rachel’s chapter follows love and second chances through moments that belong to their story.',
    photos: [
      pairPhoto('ross-rachel-prom-kiss.jpg', 'Ross and Rachel kiss after watching the prom video.'),
      pairPhoto('ross-rachel-planetarium.jpg', 'Ross and Rachel on their planetarium date.'),
      pairPhoto('ross-rachel-central-perk-kiss.jpg', 'Ross and Rachel share their first kiss at Central Perk.'),
      photo('fountain-opening.jpg', 'The opening ensemble beside the fountain, with colorful umbrellas.'),
    ],
  },
  'monica|ross': {
    title: 'Ross & Monica',
    relationship: 'Siblings, rivalry and home',
    description: 'For the Gellers, home and competition are never far apart. The Geller Cup, their dance routine and Monica’s kitchen bring together sibling rivalry, old traditions and a table that keeps everyone coming back.',
    photos: [
      pairPhoto('ross-monica-routine.jpg', 'Ross and Monica perform their dance routine together.'),
      pairPhoto('ross-monica-football.png', 'A moment from the Geller Cup football game.'),
      photo('thanksgiving-kitchen-prep.jpg', 'Thanksgiving preparation in Monica’s kitchen.'),
      photo('thanksgiving-table.jpg', 'All six friends gather at Monica’s Thanksgiving table.'),
    ],
  },
  'chandler|ross': {
    title: 'Ross & Chandler',
    relationship: 'College friendship, grown-up holidays',
    description: 'College friends become part of each other’s adult family. From conversations in the apartment kitchen to the Holiday Armadillo and Santa, this chapter is about familiarity, ridiculous situations and showing up.',
    photos: [
      pairPhoto('ross-chandler-college.jpg', 'Ross and Chandler talk in the apartment kitchen.'),
      photo('holiday-armadillo.jpg', 'Ross as the Holiday Armadillo, Chandler as Santa and Ben beside the Christmas tree.'),
      pairPhoto('ross-chandler-bullies.jpg', 'Ross and Chandler in The One with the Bullies.'),
      photo('apartment-trivia.jpg', 'Ross hosts the apartment trivia game — a memory from their shared circle.'),
    ],
  },
  'joey|ross': {
    title: 'Ross & Joey',
    relationship: 'Different personalities, dependable friends',
    description: 'Ross and Joey approach life very differently, but keep finding themselves at the same table. Poker, the apartment quiz and the Barbados trip bring their friendship into the everyday life of the group.',
    photos: [
      photo('apartment-trivia.jpg', 'Ross hosts the apartment quiz.'),
      photo('apartment-poker.jpg', 'Poker night around Monica’s kitchen table.'),
      photo('apartment-trivia-celebration.jpg', 'Joey and Chandler celebrate a quiz result — context from the game Ross hosted.'),
      photo('barbados-laptop.jpg', 'The group gathers around Ross’s laptop during the Barbados trip.'),
    ],
  },
  'phoebe|ross': {
    title: 'Ross & Phoebe',
    relationship: 'Different outlooks, the same table',
    description: 'An unlikely friendship lives comfortably inside the group’s rituals. Their Thanksgiving dinner with Will anchors this collection, followed by apartment and coffeehouse scenes from the circle they share.',
    photos: [
      photo('thanksgiving-will-dinner.jpg', 'Will joins Ross and Phoebe at Thanksgiving dinner.'),
      photo('apartment-blackout.jpg', 'Friends together during the blackout; a shared-circle apartment scene.'),
      photo('central-perk-coffee.jpg', 'The gang gathers around the Central Perk coffee table.'),
    ],
  },
  'monica|rachel': {
    title: 'Monica & Rachel',
    relationship: 'Old friends, roommates, chosen family',
    description: 'Their friendship grows around a shared home and follows them into major celebrations. Coffee with Phoebe, Monica’s wedding and the Barbados arrival make this a chapter about the women’s life together.',
    photos: [
      photo('central-perk-girls.jpg', 'Rachel, Monica and Phoebe on the Central Perk couch.'),
      photo('wedding-bridesmaids.jpg', 'Rachel and Phoebe stand with Monica in her wedding dress.'),
      photo('barbados-hotel-arrival.jpg', 'Monica, Rachel and Phoebe arrive at the Barbados hotel.'),
      photo('apartment-shopping-game.jpg', 'Rachel’s shopping-bag game — a scene from apartment life.'),
    ],
  },
  'chandler|rachel': {
    title: 'Rachel & Chandler',
    relationship: 'Everyday friendship across the hall',
    description: 'A friendship built into daily life: coffee together, apartment games and the wider circle. Their familiar neighborhood makes room for competition, celebrations and another afternoon on the couch.',
    photos: [
      photo('christmas-living-room.png', 'The friends gather around the Central Perk coffee table during the holidays.'),
      photo('central-perk-thirty.jpg', 'Monica, Chandler, Rachel and Joey sit together on the Central Perk couch.'),
      photo('apartment-trivia.jpg', 'Ross hosts the apartment trivia game — context for the apartment rivalry.'),
      photo('apartment-trivia-celebration.jpg', 'Chandler and Joey celebrate during the apartment quiz.'),
    ],
  },
  'joey|rachel': {
    title: 'Rachel & Joey',
    relationship: 'Roommates and a tender friendship',
    description: 'Shared space makes room for a tender friendship. Their chapter stays close to the everyday group: the couch, apartment games and Rachel’s memorable Thanksgiving contribution.',
    photos: [
      photo('central-perk-thirty.jpg', 'Rachel and Joey share the Central Perk couch with Monica and Chandler.'),
      photo('apartment-poker.jpg', 'Poker night around Monica’s kitchen table.'),
      photo('thanksgiving-trifle.jpg', 'Rachel presents her Thanksgiving trifle.'),
      photo('central-perk-laughter.jpg', 'A shared laugh on the orange couch — a scene from the group’s everyday life.'),
    ],
  },
  'phoebe|rachel': {
    title: 'Rachel & Phoebe',
    relationship: 'Independent lives, close friends',
    description: 'Coffee, weddings and a trip away: Rachel and Phoebe keep appearing beside one another as their lives change. With Monica alongside them, familiar rituals grow into memories of major milestones.',
    photos: [
      photo('wedding-bridesmaids.jpg', 'Rachel and Phoebe with Monica in her wedding dress.'),
      photo('central-perk-girls.jpg', 'Rachel, Phoebe and Monica together on the Central Perk couch.'),
      photo('barbados-hotel-arrival.jpg', 'Rachel, Phoebe and Monica arrive at their Barbados hotel.'),
    ],
  },
  'chandler|monica': {
    title: 'Monica & Chandler',
    relationship: 'Friendship becomes a marriage',
    description: 'A candlelit proposal leads to a wedding, a dance and an embrace. Monica and Chandler’s chapter follows friendship into a marriage, with photographs of the milestones they share.',
    photos: [
      pairPhoto('monica-chandler-embrace.jpg', 'Monica and Chandler hold hands during their candlelit proposal.'),
      pairPhoto('monica-chandler-london.jpg', 'Monica and Chandler together in London.'),
      photo('monica-chandler-wedding-landscape.jpg', 'Monica and Chandler on their wedding day.'),
      photo('wedding-monica-chandler-dancefloor.jpg', 'Monica and Chandler together on their wedding dance floor.'),
      photo('wedding-monica-chandler-kiss.jpg', 'Monica and Chandler embrace at their wedding.'),
    ],
  },
  'joey|monica': {
    title: 'Monica & Joey',
    relationship: 'Neighbors and chosen family',
    description: 'Monica’s kitchen and the familiar coffeehouse connect their days. The couch, poker nights, apartment rivalry and Thanksgiving make the neighbors part of each other’s chosen family.',
    photos: [
      photo('apartment-poker.jpg', 'Poker night at Monica’s kitchen table.'),
      photo('central-perk-thirty.jpg', 'Monica and Joey sit with Rachel and Chandler at Central Perk.'),
      photo('apartment-trivia-celebration.jpg', 'Joey and Chandler celebrate during the apartment quiz — episode context for the neighbors’ rivalry.'),
      photo('thanksgiving-table.jpg', 'All six friends at the Thanksgiving table in Monica’s apartment.'),
    ],
  },
  'monica|phoebe': {
    title: 'Monica & Phoebe',
    relationship: 'Friends with different rhythms',
    description: 'Different personalities share a place in the same close circle. From coffee together to Monica’s wedding and a trip to Barbados, their friendship keeps a place for both everyday rituals and big changes.',
    photos: [
      photo('barbados-hotel-arrival.jpg', 'Monica, Phoebe and Rachel at the Barbados hotel.'),
      photo('wedding-bridesmaids.jpg', 'Phoebe and Rachel with Monica in her wedding dress.'),
      photo('central-perk-girls.jpg', 'Monica, Phoebe and Rachel on the Central Perk couch.'),
      photo('apartment-group-hug.jpg', 'A group hug in Monica’s apartment kitchen — a wider-circle memory.'),
    ],
  },
  'chandler|joey': {
    title: 'Joey & Chandler',
    relationship: 'Roommates, teammates, best friends',
    description: 'Recliners, a hug and a victory celebrated together: Joey and Chandler make ordinary apartment life feel like an adventure. This chapter is about shared space and always having someone on your side.',
    photos: [
      pairPhoto('chandler-joey-recliners.jpg', 'Chandler and Joey relax side by side in their recliners.'),
      pairPhoto('chandler-joey-hug.png', 'Chandler and Joey share a hug.'),
      photo('apartment-trivia-celebration.jpg', 'Joey and Chandler celebrate together during the apartment quiz.'),
      photo('central-perk-thirty.jpg', 'Joey and Chandler on the coffeehouse couch with Rachel and Monica.'),
    ],
  },
  'chandler|phoebe': {
    title: 'Chandler & Phoebe',
    relationship: 'Wit, warmth and a shared circle',
    description: 'The group’s rituals keep Chandler and Phoebe in each other’s lives. Photographs on the couch, a holiday coffee and Monica’s Thanksgiving table are memories from the circle they share.',
    photos: [
      photo('central-perk-photo-sharing.jpg', 'The ensemble shares photographs on the orange Central Perk couch.'),
      photo('christmas-living-room.png', 'The friends gather at the Central Perk coffee table during the holidays.'),
      photo('thanksgiving-table.jpg', 'All six friends at Monica’s Thanksgiving table.'),
    ],
  },
  'joey|phoebe': {
    title: 'Joey & Phoebe',
    relationship: 'Loyal friends, a wedding to remember',
    description: 'Phoebe’s wedding gives this friendship a clear anchor: Joey is there to officiate as she marries Mike. The wedding photographs lead into an ensemble memory from the wider circle that surrounds them.',
    photos: [
      photo('phoebe-mike-wedding.jpg', 'Phoebe and Mike exchange rings at their snowy wedding, with Joey beside them.'),
      photo('wedding-phoebe-mike-ceremony.jpg', 'Phoebe and Mike with Joey officiating their ceremony.'),
      photo('fountain-opening.jpg', 'The opening ensemble beside the fountain — a wider-circle memory.'),
    ],
  },
}

export function getFriendsStory(viewerId: string, targetId: string): FriendsStory | null {
  const match = (id: string): Friend | null => {
    const value = /^friends-(ross|rachel|monica|chandler|joey|phoebe)$/.exec(id)?.[1]
    return value ? value as Friend : null
  }
  const viewer = match(viewerId)
  const target = match(targetId)
  if (!viewer || !target || viewer === target) return null
  return stories[[viewer, target].sort().join('|')] ?? null
}
