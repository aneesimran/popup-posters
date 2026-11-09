export type EventRow = {
  id: number;
  title: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  area: string | null;
  price: string | null;
  description: string | null;
  file_id: string;
  thumb_file_id: string | null;
  file_unique_id: string | null;
  chat_id: number | null;
  bot_msg_id: number | null;
  status: "active" | "pending";
  dedupe_key: string | null;
  postcode: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  geo_source: "postcode" | "venue" | "area" | null;
  created_at: string;
};

export type Extraction = {
  is_event: boolean;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  area: string | null;
  price: string | null;
  description: string | null;
  postcode: string | null;
  region: string | null;
};

export type DateReply = {
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
};
