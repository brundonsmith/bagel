import React from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'JavaScript Native',
    src: '/img/js-bagel.png',
    description: (
      <>
        Bagel compiles to JavaScript, is inspired by JavaScript syntax and 
        semantics, and supports easy interop with the JavaScript ecosystem.
        You'll feel right at home.
      </>
    ),
  },
  {
    title: 'Statically Typed',
    src: '/img/bagel-factory.png',
    description: (
      <>
        Bagel is statically and strongly typed, but with a focus on staying
        practical. It'll help make sure you ship as few bugs to production as
        possible.
      </>
    ),
  },
  {
    title: 'Reactive By Default',
    src: '/img/coder-bagel.png',
    description: (
      <>
        Reactivity to changing state is built into the language, whether you use
        it for a UI or something else. You'll never have to track
        dependencies or manually synchronize state again.
      </>
    ),
  },
];

function Feature({src, title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <img src={src} className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
