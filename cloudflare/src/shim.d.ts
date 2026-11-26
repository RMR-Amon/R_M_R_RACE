/** the game's translation module mentions browser globals (guarded by typeof checks at run time) */
declare const document: undefined | { documentElement: { lang: string } };
interface Navigator {
  readonly language: string;
}
