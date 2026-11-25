import {
  ArrowDown,
  ArrowRight,
  Gift,
  Mail,
  MapPin,
  Palette,
  Phone,
  Printer,
  Scissors,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import "./home.css";

const services = [
  {
    icon: Printer,
    number: "01",
    title: "Impresiones",
    description: "Impresiones cuidadas para tus ideas, proyectos y ocasiones especiales.",
    color: "mint",
  },
  {
    icon: Palette,
    number: "02",
    title: "Diseño gráfico",
    description: "Diseños personalizados que hacen que tu marca y tus momentos destaquen.",
    color: "peach",
  },
  {
    icon: Gift,
    number: "03",
    title: "Invitaciones y detalles",
    description: "Detalles bonitos para celebrar cumpleaños, eventos y días inolvidables.",
    color: "lavender",
  },
  {
    icon: Scissors,
    number: "04",
    title: "Papelería creativa",
    description: "Papelería y piezas gráficas hechas con dedicación y mucho cariño.",
    color: "yellow",
  },
];

const logoUrl = `${import.meta.env.BASE_URL}images/mimitos-logo.jpg`;

export default function Home() {
  return (
    <main className="mimitos-home">
      <header className="home-header">
        <a className="home-brand" href="#inicio" aria-label="Mimitos Artes Gráficas, inicio">
          <img src={logoUrl} alt="Logo de Mimitos Artes Gráficas" />
          <span>
            <strong>MIMITOS</strong>
            <small>ARTES GRÁFICAS</small>
          </span>
        </a>
        <nav className="home-nav" aria-label="Navegación principal">
          <a href="#servicios">Servicios</a>
          <a href="#nosotros">Nosotros</a>
          <a href="#contacto">Contacto</a>
        </nav>
        <Link className="home-login" href="/login">
          Iniciar sesión <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <section className="home-hero" id="inicio">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            CREATIVIDAD HECHA CON CARIÑO
          </div>
          <h1>
            Tus ideas,
            <br />
            llenas de <span>color.</span>
          </h1>
          <p>
            Creamos detalles gráficos únicos para regalar, celebrar y hacer que cada idea
            se convierta en algo especial.
          </p>
          <div className="hero-actions">
            <a className="button-primary" href="#servicios">
              Descubre lo que hacemos <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="button-text" href="#contacto">
              Hablemos de tu idea
            </a>
          </div>
          <div className="hero-note">
            <span className="note-sparkle">✳</span>
            Cada detalle cuenta. El tuyo también.
          </div>
        </div>

        <div className="hero-art" aria-label="Inspiración creativa de Mimitos">
          <div className="art-sunburst" />
          <div className="art-sticker sticker-one">hecho<br />con amor</div>
          <div className="art-sticker sticker-two">¡celebra!</div>
          <div className="art-card art-card-back">
            <div className="card-confetti">✳　✿　✳</div>
            <span>un detalle</span>
            <strong>para ti</strong>
            <div className="card-ribbon" />
          </div>
          <div className="art-card art-card-front">
            <img src={logoUrl} alt="" />
            <span>IMAGINAMOS · DISEÑAMOS · CREAMOS</span>
          </div>
          <div className="art-pencil"><span /></div>
          <div className="art-caption">
            <Sparkles size={16} aria-hidden="true" />
            Pequeños detalles, grandes sonrisas
          </div>
        </div>
        <a href="#servicios" className="scroll-cue" aria-label="Desliza para ver nuestros servicios">
          <ArrowDown size={17} aria-hidden="true" />
        </a>
      </section>

      <section className="home-services" id="servicios">
        <div className="section-heading">
          <span className="section-kicker">LO QUE HACEMOS</span>
          <h2>Un mundo de ideas bonitas</h2>
          <p>Un toque creativo para eso que quieres compartir con el mundo.</p>
        </div>
        <div className="service-grid">
          {services.map(({ icon: Icon, number, title, description, color }) => (
            <article className="service-card" key={number}>
              <div className={`service-icon ${color}`}>
                <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <span className="service-number">{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <a href="#contacto" aria-label={`Consultar por ${title}`}>
                Cuéntanos tu idea <ArrowRight size={15} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="home-about" id="nosotros">
        <div className="about-mark">
          <div className="about-circle">
            <img src={logoUrl} alt="Mimitos Artes Gráficas" />
          </div>
          <span className="about-doodle">✳</span>
        </div>
        <div className="about-copy">
          <span className="section-kicker">UN MIMITO EN CADA CREACIÓN</span>
          <h2>Hecho con cariño, pensado para ti.</h2>
          <p>
            En Mimitos Artes Gráficas creemos que las ideas más lindas merecen
            convertirse en algo que puedas tocar, regalar y recordar. Ponemos
            creatividad y dedicación en cada trabajo.
          </p>
          <a className="button-primary" href="#contacto">
            Hagamos algo bonito <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="home-contact" id="contacto">
        <div className="contact-heading">
          <span className="section-kicker">ESTAMOS PARA AYUDARTE</span>
          <h2>¿Qué tienes en mente?</h2>
          <p>Escríbenos o visítanos. ¡Nos encantará conocer tu idea!</p>
        </div>
        <div className="contact-details">
          <a href="tel:65488226">
            <span><Phone size={19} aria-hidden="true" /></span>
            <small>LLÁMANOS</small>
            <strong>65488226</strong>
          </a>
          <a href="mailto:mimitosartesgraficas@gmail.com">
            <span><Mail size={19} aria-hidden="true" /></span>
            <small>ESCRÍBENOS</small>
            <strong>mimitosartesgraficas@gmail.com</strong>
          </a>
          <div>
            <span><MapPin size={19} aria-hidden="true" /></span>
            <small>VISÍTANOS</small>
            <strong>Almirante Graun N° 161</strong>
          </div>
        </div>
        <a className="contact-login" href="tel:65488226">
          <Phone size={16} aria-hidden="true" /> Contactar ahora
        </a>
      </section>

      <footer className="home-footer">
        <a className="footer-brand" href="#inicio">
          <img src={logoUrl} alt="" />
          <span>MIMITOS ARTES GRÁFICAS</span>
        </a>
        <span>Creando con cariño, para momentos especiales. <span aria-hidden="true">♥</span></span>
        <Link href="/login" className="footer-login">Acceso al sistema</Link>
      </footer>
    </main>
  );
}
