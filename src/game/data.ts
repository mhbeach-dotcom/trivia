import type { Question } from "../types";
import hg from "../data/hunger-games.json";
import cf from "../data/catching-fire.json";
import mj from "../data/mockingjay.json";
import ballad from "../data/ballad.json";
import sunrise from "../data/sunrise.json";

export const ALL_QUESTIONS: Question[] = [...hg, ...cf, ...mj, ...ballad, ...sunrise] as Question[];
