--
-- PostgreSQL database dump
--

\restrict I2SxQ0n2vgz3JDKbTVxor43dcX0zBbYDM15jXzBOSvHy2k5t2fEfUZJYwwR5ri3

-- Dumped from database version 14.19 (Homebrew)
-- Dumped by pg_dump version 14.19 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    id integer NOT NULL,
    username character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    pg_id integer,
    device_token character varying(255)
);


--
-- Name: admins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id integer NOT NULL,
    email character varying NOT NULL,
    pg_id integer,
    meal_type character varying(50) NOT NULL,
    date date NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_id_seq OWNED BY public.attendance.id;


--
-- Name: email_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_otps (
    email character varying(100) NOT NULL,
    otp character varying(10) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    username character varying(100)
);


--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    pg_id integer NOT NULL,
    status integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_email character varying
);


--
-- Name: enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enrollments_id_seq OWNED BY public.enrollments.id;


--
-- Name: meal_menus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meal_menus (
    id integer NOT NULL,
    pg_id integer NOT NULL,
    date date NOT NULL,
    meal_type character varying(20) NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT meal_menus_meal_type_check CHECK (((meal_type)::text = ANY ((ARRAY['breakfast'::character varying, 'lunch'::character varying, 'dinner'::character varying])::text[])))
);


--
-- Name: meal_menus_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meal_menus_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meal_menus_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meal_menus_id_seq OWNED BY public.meal_menus.id;


--
-- Name: meal_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meal_responses (
    id integer NOT NULL,
    meal_id integer,
    opted_in boolean,
    responded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(100)
);


--
-- Name: meal_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meal_responses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meal_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meal_responses_id_seq OWNED BY public.meal_responses.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    meal_id integer,
    message text,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id integer,
    admin_id integer,
    type character varying(32),
    title character varying(255),
    read boolean DEFAULT false
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: pgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgs (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    address character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pgs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgs_id_seq OWNED BY public.pgs.id;


--
-- Name: user_meal_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_meal_enrollments (
    id integer NOT NULL,
    user_id integer,
    pg_id integer,
    meal_type character varying(50),
    date date,
    enrolled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    email character varying
);


--
-- Name: user_meal_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_meal_enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_meal_enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_meal_enrollments_id_seq OWNED BY public.user_meal_enrollments.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    phone character varying(20),
    name character varying(100),
    email character varying(100),
    company character varying(100),
    room_no character varying(20),
    pg_id integer,
    is_admin boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    device_token character varying(255)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: admins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);


--
-- Name: attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance ALTER COLUMN id SET DEFAULT nextval('public.attendance_id_seq'::regclass);


--
-- Name: enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments ALTER COLUMN id SET DEFAULT nextval('public.enrollments_id_seq'::regclass);


--
-- Name: meal_menus id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_menus ALTER COLUMN id SET DEFAULT nextval('public.meal_menus_id_seq'::regclass);


--
-- Name: meal_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_responses ALTER COLUMN id SET DEFAULT nextval('public.meal_responses_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: pgs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgs ALTER COLUMN id SET DEFAULT nextval('public.pgs_id_seq'::regclass);


--
-- Name: user_meal_enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments ALTER COLUMN id SET DEFAULT nextval('public.user_meal_enrollments_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);


--
-- Name: attendance attendance_email_pg_id_meal_type_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_email_pg_id_meal_type_date_key UNIQUE (email, pg_id, meal_type, date);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);


--
-- Name: enrollments enrollments_user_email_pg_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_user_email_pg_unique UNIQUE (user_email, pg_id);


--
-- Name: meal_menus meal_menus_pg_id_date_meal_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_menus
    ADD CONSTRAINT meal_menus_pg_id_date_meal_type_key UNIQUE (pg_id, date, meal_type);


--
-- Name: meal_menus meal_menus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_menus
    ADD CONSTRAINT meal_menus_pkey PRIMARY KEY (id);


--
-- Name: meal_responses meal_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_responses
    ADD CONSTRAINT meal_responses_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: pgs pgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgs
    ADD CONSTRAINT pgs_pkey PRIMARY KEY (id);


--
-- Name: user_meal_enrollments user_meal_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments
    ADD CONSTRAINT user_meal_enrollments_pkey PRIMARY KEY (id);


--
-- Name: user_meal_enrollments user_meal_enrollments_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments
    ADD CONSTRAINT user_meal_enrollments_unique UNIQUE (user_id, pg_id, date, meal_type);


--
-- Name: user_meal_enrollments user_meal_enrollments_unique_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments
    ADD CONSTRAINT user_meal_enrollments_unique_email UNIQUE (email, pg_id, meal_type, date);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_meal_menus_pg_date_mealtype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meal_menus_pg_date_mealtype ON public.meal_menus USING btree (pg_id, date, meal_type);


--
-- Name: admins admins_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id);


--
-- Name: attendance attendance_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id);


--
-- Name: enrollments enrollments_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id);


--
-- Name: enrollments enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: meal_menus meal_menus_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_menus
    ADD CONSTRAINT meal_menus_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id) ON DELETE CASCADE;


--
-- Name: meal_responses meal_responses_email_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meal_responses
    ADD CONSTRAINT meal_responses_email_fkey FOREIGN KEY (email) REFERENCES public.users(email);


--
-- Name: notifications notifications_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_meal_enrollments user_meal_enrollments_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments
    ADD CONSTRAINT user_meal_enrollments_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id);


--
-- Name: user_meal_enrollments user_meal_enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_meal_enrollments
    ADD CONSTRAINT user_meal_enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_pg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pg_id_fkey FOREIGN KEY (pg_id) REFERENCES public.pgs(id);


--
-- PostgreSQL database dump complete
--

\unrestrict I2SxQ0n2vgz3JDKbTVxor43dcX0zBbYDM15jXzBOSvHy2k5t2fEfUZJYwwR5ri3

